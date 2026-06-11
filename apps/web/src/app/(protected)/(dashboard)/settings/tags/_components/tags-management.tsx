"use client"

import {
  DEFAULT_TAG_COLOR,
  MAX_TAG_NAME_LENGTH,
  TAG_COLORS,
  type TagColor,
} from "@crikket/shared/constants/tag"
import { Button } from "@crikket/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crikket/ui/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@crikket/ui/components/ui/dialog"
import { Field, FieldLabel } from "@crikket/ui/components/ui/field"
import { Input } from "@crikket/ui/components/ui/input"
import { cn } from "@crikket/ui/lib/utils"
import { Plus } from "lucide-react"
import { useRouter } from "nextjs-toploader/app"
import * as React from "react"
import { toast } from "sonner"
import { TagBadge } from "@/components/bug-reports/tag-badge"
import { TAG_COLOR_DOT } from "@/components/bug-reports/tag-colors"
import type { OrgTag } from "@/components/bug-reports/use-org-tags"
import { client } from "@/utils/orpc"

interface Props {
  canManage: boolean
  initialTags: OrgTag[]
}

export function TagsManagement({ canManage, initialTags }: Props) {
  const router = useRouter()
  const [tags, setTags] = React.useState(initialTags)
  const [isCreateOpen, setIsCreateOpen] = React.useState(false)
  const [editingTag, setEditingTag] = React.useState<OrgTag | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  async function handleCreate(values: { name: string; color: TagColor }) {
    setIsSubmitting(true)
    try {
      const created = await client.tag.create(values)
      setTags((prev) =>
        prev.some((tag) => tag.id === created.id)
          ? prev.map((tag) => (tag.id === created.id ? created : tag))
          : [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
      )
      setIsCreateOpen(false)
      toast.success("Tag created")
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create tag"
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleUpdate(
    id: string,
    values: { name: string; color: TagColor }
  ) {
    setIsSubmitting(true)
    try {
      const updated = await client.tag.update({ id, ...values })
      if (updated) {
        setTags((prev) =>
          prev
            .map((tag) => (tag.id === id ? updated : tag))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      }
      setEditingTag(null)
      toast.success("Tag updated")
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update tag"
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleDelete(tag: OrgTag) {
    // biome-ignore lint/suspicious/noAlert: intentional simple confirmation for destructive action
    const confirmed = confirm(
      `Delete tag "${tag.name}"? It will be removed from all reports.`
    )
    if (!confirmed) {
      return
    }
    try {
      await client.tag.delete({ id: tag.id })
      setTags((prev) => prev.filter((entry) => entry.id !== tag.id))
      toast.success("Tag deleted")
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete tag"
      )
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Tags</CardTitle>
            <CardDescription>
              Create reusable, colored tags to label and filter bug reports
              across your organization.
            </CardDescription>
          </div>
          <Button
            disabled={!canManage}
            onClick={() => setIsCreateOpen(true)}
            type="button"
          >
            <Plus />
            New tag
          </Button>
        </CardHeader>
        <CardContent>
          {tags.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No tags yet. Create one to start labeling your reports.
            </p>
          ) : (
            <ul className="divide-y">
              {tags.map((tag) => (
                <li
                  className="flex items-center justify-between gap-3 py-3"
                  key={tag.id}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <TagBadge tag={tag} withDot />
                    <span className="truncate text-muted-foreground text-xs">
                      {tag.slug}
                    </span>
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        onClick={() => setEditingTag(tag)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Edit
                      </Button>
                      <Button
                        onClick={() => handleDelete(tag)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog onOpenChange={setIsCreateOpen} open={isCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create tag</DialogTitle>
          </DialogHeader>
          <TagForm isSubmitting={isSubmitting} onSubmit={handleCreate} />
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setEditingTag(null)
          }
        }}
        open={editingTag !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit tag</DialogTitle>
          </DialogHeader>
          {editingTag ? (
            <TagForm
              initialColor={editingTag.color as TagColor}
              initialName={editingTag.name}
              isSubmitting={isSubmitting}
              onSubmit={(values) => handleUpdate(editingTag.id, values)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TagForm({
  initialName = "",
  initialColor = DEFAULT_TAG_COLOR,
  isSubmitting,
  onSubmit,
}: {
  initialName?: string
  initialColor?: TagColor
  isSubmitting: boolean
  onSubmit: (values: { name: string; color: TagColor }) => void
}) {
  const [name, setName] = React.useState(initialName)
  const [color, setColor] = React.useState<TagColor>(initialColor)
  const trimmed = name.trim()

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!trimmed) {
          return
        }
        onSubmit({ name: trimmed, color })
      }}
    >
      <Field>
        <FieldLabel htmlFor="tag-name">Name</FieldLabel>
        <Input
          autoFocus
          id="tag-name"
          maxLength={MAX_TAG_NAME_LENGTH}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. auth, onboarding, regression"
          value={name}
        />
      </Field>

      <Field>
        <FieldLabel>Color</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {TAG_COLORS.map((option) => (
            <button
              aria-label={option}
              aria-pressed={color === option}
              className={cn(
                "size-7 rounded-full ring-offset-2 ring-offset-background transition-all",
                TAG_COLOR_DOT[option],
                color === option
                  ? "ring-2 ring-foreground"
                  : "ring-0 hover:scale-110"
              )}
              key={option}
              onClick={() => setColor(option)}
              type="button"
            />
          ))}
        </div>
      </Field>

      <DialogFooter>
        <Button disabled={isSubmitting || !trimmed} type="submit">
          {isSubmitting ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  )
}
