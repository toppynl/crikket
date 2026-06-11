"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { client } from "@/utils/orpc"
import { TagBadge, type TagSummary } from "./tag-badge"
import { TagMultiSelect } from "./tag-multi-select"

interface BugReportTagsFieldProps {
  reportId: string
  tags: TagSummary[]
  editable?: boolean
  allowCreate?: boolean
  emptyText?: string
  onUpdated?: () => Promise<void> | void
}

export function BugReportTagsField({
  reportId,
  tags,
  editable = true,
  allowCreate = true,
  emptyText = "No tags",
  onUpdated,
}: BugReportTagsFieldProps) {
  const [selectedIds, setSelectedIds] = useState(tags.map((tag) => tag.id))
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    setSelectedIds(tags.map((tag) => tag.id))
  }, [tags])

  if (!editable) {
    if (tags.length === 0) {
      return <span className="text-muted-foreground text-sm">{emptyText}</span>
    }
    return (
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <TagBadge key={tag.id} tag={tag} withDot />
        ))}
      </div>
    )
  }

  const handleChange = async (ids: string[]) => {
    const previous = selectedIds
    setSelectedIds(ids)
    setIsSaving(true)
    try {
      await client.bugReport.update({ id: reportId, tagIds: ids })
      await onUpdated?.()
    } catch (error) {
      setSelectedIds(previous)
      toast.error(
        error instanceof Error ? error.message : "Failed to update tags"
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <TagMultiSelect
      allowCreate={allowCreate}
      disabled={isSaving}
      onChange={handleChange}
      selectedIds={selectedIds}
    />
  )
}
