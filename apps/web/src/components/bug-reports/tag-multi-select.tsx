"use client"

import { normalizeTagSlug } from "@crikket/shared/constants/tag"
import { Button } from "@crikket/ui/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@crikket/ui/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@crikket/ui/components/ui/popover"
import { cn } from "@crikket/ui/lib/utils"
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { TagBadge } from "./tag-badge"
import { tagDotClasses } from "./tag-colors"
import { useOrgTags } from "./use-org-tags"

interface TagMultiSelectProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  allowCreate?: boolean
  disabled?: boolean
  placeholder?: string
  triggerClassName?: string
}

export function TagMultiSelect({
  selectedIds,
  onChange,
  allowCreate = true,
  disabled,
  placeholder = "Add tags",
  triggerClassName,
}: TagMultiSelectProps) {
  const { tags, isLoading, createTag, isCreating } = useOrgTags()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const selectedTags = useMemo(
    () =>
      selectedIds
        .map((id) => tags.find((tag) => tag.id === id))
        .filter((tag): tag is (typeof tags)[number] => Boolean(tag)),
    [selectedIds, tags]
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return tags
    }
    return tags.filter((tag) => tag.name.toLowerCase().includes(query))
  }, [tags, search])

  const searchSlug = normalizeTagSlug(search)
  const exactExists = tags.some((tag) => tag.slug === searchSlug)
  const canCreate = allowCreate && searchSlug.length > 0 && !exactExists

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((value) => value !== id)
        : [...selectedIds, id]
    )
  }

  const handleCreate = async () => {
    const name = search.trim()
    if (!name) {
      return
    }
    try {
      const created = await createTag(name)
      if (created && !selectedIds.includes(created.id)) {
        onChange([...selectedIds, created.id])
      }
      setSearch("")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create tag"
      )
    }
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            className={cn(
              "h-auto min-h-9 w-full justify-between font-normal",
              triggerClassName
            )}
            type="button"
            variant="outline"
          />
        }
      >
        <span className="flex flex-1 flex-wrap items-center gap-1 overflow-hidden">
          {selectedTags.length > 0 ? (
            selectedTags.map((tag) => (
              <TagBadge key={tag.id} tag={tag} withDot />
            ))
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </span>
        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            onValueChange={setSearch}
            placeholder="Search or create tags..."
            value={search}
          />
          <CommandList>
            {isLoading ? (
              <div className="py-6 text-center text-muted-foreground text-sm">
                Loading tags…
              </div>
            ) : null}
            {!isLoading && filtered.length === 0 && !canCreate ? (
              <CommandEmpty>No tags found.</CommandEmpty>
            ) : null}
            <CommandGroup>
              {filtered.map((tag) => {
                const checked = selectedIds.includes(tag.id)
                return (
                  <CommandItem
                    className="gap-2"
                    key={tag.id}
                    onSelect={() => toggle(tag.id)}
                    value={tag.id}
                  >
                    <span
                      className={cn(
                        "flex size-4 items-center justify-center rounded-sm border",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40"
                      )}
                    >
                      {checked ? <Check className="size-3" /> : null}
                    </span>
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        tagDotClasses(tag.color)
                      )}
                    />
                    <span className="flex-1 truncate">{tag.name}</span>
                  </CommandItem>
                )
              })}
              {canCreate ? (
                <CommandItem
                  className="gap-2"
                  disabled={isCreating}
                  onSelect={handleCreate}
                  value={`__create__${search}`}
                >
                  {isCreating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Create &ldquo;{search.trim()}&rdquo;
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
