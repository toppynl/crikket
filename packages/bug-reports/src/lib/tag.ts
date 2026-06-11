import { db } from "@crikket/db"
import { bugReport } from "@crikket/db/schema/bug-report"
import { bugReportTag, tag } from "@crikket/db/schema/tag"
import {
  DEFAULT_TAG_COLOR,
  isTagColor,
  normalizeTagName,
  normalizeTagSlug,
  type TagColor,
} from "@crikket/shared/constants/tag"
import { and, asc, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"

export interface TagRecord {
  id: string
  organizationId: string
  name: string
  slug: string
  color: TagColor
  createdAt: Date
  updatedAt: Date
}

function toRecord(row: typeof tag.$inferSelect): TagRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    color: isTagColor(row.color) ? row.color : DEFAULT_TAG_COLOR,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function requireNameAndSlug(name: string): { name: string; slug: string } {
  const normalizedName = normalizeTagName(name)
  const slug = normalizeTagSlug(name)
  if (!(normalizedName && slug)) {
    throw new Error("Tag name must contain at least one letter or number.")
  }
  return { name: normalizedName, slug }
}

export async function listTags(input: {
  organizationId: string
}): Promise<TagRecord[]> {
  const rows = await db.query.tag.findMany({
    where: eq(tag.organizationId, input.organizationId),
    orderBy: [asc(tag.name)],
  })
  return rows.map(toRecord)
}

export async function getTagById(input: {
  id: string
  organizationId: string
}): Promise<TagRecord | null> {
  const row = await db.query.tag.findFirst({
    where: and(
      eq(tag.id, input.id),
      eq(tag.organizationId, input.organizationId)
    ),
  })
  return row ? toRecord(row) : null
}

/**
 * Create a tag, or return the existing tag when one already matches the
 * normalized slug for this organization (idempotent inline-create UX).
 */
export async function createTag(input: {
  organizationId: string
  name: string
  color?: string
}): Promise<TagRecord> {
  const { name, slug } = requireNameAndSlug(input.name)
  const color = isTagColor(input.color) ? input.color : DEFAULT_TAG_COLOR

  const existing = await db.query.tag.findFirst({
    where: and(
      eq(tag.organizationId, input.organizationId),
      eq(tag.slug, slug)
    ),
  })
  if (existing) {
    return toRecord(existing)
  }

  const [row] = await db
    .insert(tag)
    .values({
      id: nanoid(16),
      organizationId: input.organizationId,
      name,
      slug,
      color,
    })
    .onConflictDoNothing({ target: [tag.organizationId, tag.slug] })
    .returning()

  if (row) {
    return toRecord(row)
  }

  // Lost a race to a concurrent insert — fetch the winner.
  const winner = await db.query.tag.findFirst({
    where: and(
      eq(tag.organizationId, input.organizationId),
      eq(tag.slug, slug)
    ),
  })
  if (!winner) {
    throw new Error("Failed to create tag.")
  }
  return toRecord(winner)
}

export async function updateTag(input: {
  id: string
  organizationId: string
  name?: string
  color?: string
}): Promise<TagRecord | null> {
  const set: Partial<typeof tag.$inferInsert> = {}
  if (input.name !== undefined) {
    const { name, slug } = requireNameAndSlug(input.name)
    set.name = name
    set.slug = slug
  }
  if (input.color !== undefined && isTagColor(input.color)) {
    set.color = input.color
  }

  if (Object.keys(set).length === 0) {
    return await getTagById({
      id: input.id,
      organizationId: input.organizationId,
    })
  }

  const [row] = await db
    .update(tag)
    .set(set)
    .where(
      and(eq(tag.id, input.id), eq(tag.organizationId, input.organizationId))
    )
    .returning()

  if (set.name && row) {
    // Keep the denormalized bug_report.tags name mirror in sync after a rename.
    await syncTagNameMirror({
      organizationId: input.organizationId,
      tagId: input.id,
    })
  }

  return row ? toRecord(row) : null
}

export async function deleteTag(input: {
  id: string
  organizationId: string
}): Promise<void> {
  const affected = await db.query.bugReportTag.findMany({
    where: eq(bugReportTag.tagId, input.id),
    columns: { bugReportId: true },
  })
  await db
    .delete(tag)
    .where(
      and(eq(tag.id, input.id), eq(tag.organizationId, input.organizationId))
    )
  // Refresh the name mirror for reports that referenced the removed tag.
  await Promise.all(
    affected.map((row) =>
      syncBugReportTagMirror({
        bugReportId: row.bugReportId,
        organizationId: input.organizationId,
      })
    )
  )
}

/**
 * Find-or-create managed tags from free-text names (used by SDK ingest).
 * Returns the resolved tag ids in input order, de-duplicated by slug.
 */
export async function resolveTagsByName(input: {
  organizationId: string
  names: string[]
}): Promise<string[]> {
  const bySlug = new Map<string, string>()
  for (const raw of input.names) {
    const slug = normalizeTagSlug(raw)
    const name = normalizeTagName(raw)
    if (slug && name && !bySlug.has(slug)) {
      bySlug.set(slug, name)
    }
  }
  if (bySlug.size === 0) {
    return []
  }

  const slugs = Array.from(bySlug.keys())
  await db
    .insert(tag)
    .values(
      Array.from(bySlug.entries()).map(([slug, name]) => ({
        id: nanoid(16),
        organizationId: input.organizationId,
        name,
        slug,
        color: DEFAULT_TAG_COLOR,
      }))
    )
    .onConflictDoNothing({ target: [tag.organizationId, tag.slug] })

  const rows = await db.query.tag.findMany({
    where: and(
      eq(tag.organizationId, input.organizationId),
      inArray(tag.slug, slugs)
    ),
    columns: { id: true },
  })
  return rows.map((row) => row.id)
}

/**
 * Fetch managed tags for many reports at once, keyed by bug report id.
 */
export async function getTagsForBugReports(
  bugReportIds: string[]
): Promise<Map<string, TagRecord[]>> {
  const result = new Map<string, TagRecord[]>()
  if (bugReportIds.length === 0) {
    return result
  }

  const rows = await db
    .select({
      bugReportId: bugReportTag.bugReportId,
      tag,
    })
    .from(bugReportTag)
    .innerJoin(tag, eq(bugReportTag.tagId, tag.id))
    .where(inArray(bugReportTag.bugReportId, bugReportIds))
    .orderBy(asc(tag.name))

  for (const row of rows) {
    const list = result.get(row.bugReportId) ?? []
    list.push(toRecord(row.tag))
    result.set(row.bugReportId, list)
  }
  return result
}

export async function getTagsForBugReport(
  bugReportId: string
): Promise<TagRecord[]> {
  const map = await getTagsForBugReports([bugReportId])
  return map.get(bugReportId) ?? []
}

/**
 * Replace the tag set for a report. Validates tag ownership, rewrites the join
 * rows, and keeps the denormalized bug_report.tags name mirror in sync.
 */
export async function setBugReportTags(input: {
  bugReportId: string
  organizationId: string
  tagIds: string[]
}): Promise<void> {
  const uniqueIds = Array.from(new Set(input.tagIds))
  const validTags =
    uniqueIds.length > 0
      ? await db.query.tag.findMany({
          where: and(
            eq(tag.organizationId, input.organizationId),
            inArray(tag.id, uniqueIds)
          ),
          orderBy: [asc(tag.name)],
        })
      : []

  const validIds = validTags.map((row) => row.id)
  const names = validTags.map((row) => row.name)

  await db.transaction(async (tx) => {
    await tx
      .delete(bugReportTag)
      .where(eq(bugReportTag.bugReportId, input.bugReportId))
    if (validIds.length > 0) {
      await tx
        .insert(bugReportTag)
        .values(
          validIds.map((tagId) => ({ bugReportId: input.bugReportId, tagId }))
        )
        .onConflictDoNothing()
    }
    await tx
      .update(bugReport)
      .set({ tags: names })
      .where(
        and(
          eq(bugReport.id, input.bugReportId),
          eq(bugReport.organizationId, input.organizationId)
        )
      )
  })
}

/**
 * Apply the same tag set to many reports (bulk edit).
 */
export async function setBugReportTagsForMany(input: {
  bugReportIds: string[]
  organizationId: string
  tagIds: string[]
}): Promise<void> {
  const uniqueReportIds = Array.from(new Set(input.bugReportIds))
  if (uniqueReportIds.length === 0) {
    return
  }
  const uniqueTagIds = Array.from(new Set(input.tagIds))
  const validTags =
    uniqueTagIds.length > 0
      ? await db.query.tag.findMany({
          where: and(
            eq(tag.organizationId, input.organizationId),
            inArray(tag.id, uniqueTagIds)
          ),
          orderBy: [asc(tag.name)],
        })
      : []
  const validIds = validTags.map((row) => row.id)
  const names = validTags.map((row) => row.name)

  await db.transaction(async (tx) => {
    await tx
      .delete(bugReportTag)
      .where(inArray(bugReportTag.bugReportId, uniqueReportIds))
    if (validIds.length > 0) {
      await tx
        .insert(bugReportTag)
        .values(
          uniqueReportIds.flatMap((bugReportId) =>
            validIds.map((tagId) => ({ bugReportId, tagId }))
          )
        )
        .onConflictDoNothing()
    }
    await tx
      .update(bugReport)
      .set({ tags: names })
      .where(
        and(
          eq(bugReport.organizationId, input.organizationId),
          inArray(bugReport.id, uniqueReportIds)
        )
      )
  })
}

async function syncBugReportTagMirror(input: {
  bugReportId: string
  organizationId: string
}): Promise<void> {
  const tags = await getTagsForBugReport(input.bugReportId)
  await db
    .update(bugReport)
    .set({ tags: tags.map((row) => row.name) })
    .where(
      and(
        eq(bugReport.id, input.bugReportId),
        eq(bugReport.organizationId, input.organizationId)
      )
    )
}

async function syncTagNameMirror(input: {
  organizationId: string
  tagId: string
}): Promise<void> {
  const affected = await db.query.bugReportTag.findMany({
    where: eq(bugReportTag.tagId, input.tagId),
    columns: { bugReportId: true },
  })
  await Promise.all(
    affected.map((row) =>
      syncBugReportTagMirror({
        bugReportId: row.bugReportId,
        organizationId: input.organizationId,
      })
    )
  )
}
