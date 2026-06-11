import { cn } from "@crikket/ui/lib/utils"
import { X } from "lucide-react"

import { tagBadgeClasses, tagDotClasses } from "./tag-colors"

export interface TagSummary {
  id: string
  name: string
  color: string
}

interface TagBadgeProps {
  tag: Pick<TagSummary, "name" | "color">
  className?: string
  onRemove?: () => void
  withDot?: boolean
}

export function TagBadge({ tag, className, onRemove, withDot }: TagBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-medium text-[11px]",
        tagBadgeClasses(tag.color),
        className
      )}
    >
      {withDot ? (
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            tagDotClasses(tag.color)
          )}
        />
      ) : null}
      <span className="max-w-[140px] truncate">{tag.name}</span>
      {onRemove ? (
        <button
          aria-label={`Remove ${tag.name}`}
          className="-mr-0.5 ml-0.5 rounded-sm opacity-70 transition-opacity hover:opacity-100"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onRemove()
          }}
          type="button"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  )
}
