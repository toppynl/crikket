export const TAG_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "indigo",
  "violet",
  "pink",
] as const

export type TagColor = (typeof TAG_COLORS)[number]

export const DEFAULT_TAG_COLOR: TagColor = "gray"

export const MAX_TAG_NAME_LENGTH = 40
export const MAX_TAG_SLUG_LENGTH = 60
export const MAX_TAGS_PER_REPORT = 20

export function isTagColor(value: unknown): value is TagColor {
  return (
    typeof value === "string" &&
    (TAG_COLORS as readonly string[]).includes(value)
  )
}

/**
 * Normalize a free-text tag name into a stable, case-insensitive slug used for
 * org-scoped uniqueness and find-or-create matching.
 */
export function normalizeTagSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TAG_SLUG_LENGTH)
}

export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_NAME_LENGTH)
}
