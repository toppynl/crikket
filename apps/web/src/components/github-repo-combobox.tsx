"use client"

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
import { ChevronsUpDown } from "lucide-react"
import * as React from "react"
import { client } from "@/utils/orpc"

interface Props {
  installationId: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

export function RepoCombobox({
  installationId,
  value,
  onChange,
  disabled,
}: Props) {
  const [open, setOpen] = React.useState(false)
  const [repos, setRepos] = React.useState<{ owner: string; name: string }[]>(
    []
  )
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!installationId) return
    setLoading(true)
    client.github
      .listRepos({ installationId })
      .then(setRepos)
      .catch(() => setRepos([]))
      .finally(() => setLoading(false))
  }, [installationId])

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            className="w-full justify-between font-normal"
            disabled={disabled || loading}
            variant="outline"
          />
        }
      >
        {value || (loading ? "Loading repositories…" : "Select repository…")}
        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) p-0">
        <Command>
          <CommandInput placeholder="Search repositories…" />
          <CommandList>
            <CommandEmpty>No repositories found.</CommandEmpty>
            <CommandGroup>
              {repos.map((repo) => (
                <CommandItem
                  data-checked={value === repo.name}
                  key={`${repo.owner}/${repo.name}`}
                  onSelect={() => {
                    onChange(repo.name)
                    setOpen(false)
                  }}
                  value={repo.name}
                >
                  <span className="mr-1 text-muted-foreground">
                    {repo.owner}/
                  </span>
                  {repo.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
