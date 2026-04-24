import { db } from "@crikket/db"
import { project } from "@crikket/db/schema/project"
import { and, desc, eq } from "drizzle-orm"
import { nanoid } from "nanoid"

export interface ProjectRecord {
  id: string
  organizationId: string
  name: string
  slug: string
  description: string | null
  createdAt: Date
  updatedAt: Date
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function requireSlug(value: string): string {
  const slug = normalizeSlug(value)
  if (!slug) throw new Error("Project slug must not be empty.")
  return slug
}

function toRecord(row: typeof project.$inferSelect): ProjectRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function listProjects(input: {
  organizationId: string
}): Promise<ProjectRecord[]> {
  const rows = await db.query.project.findMany({
    where: eq(project.organizationId, input.organizationId),
    orderBy: [desc(project.createdAt)],
  })
  return rows.map(toRecord)
}

export async function getProjectById(input: {
  id: string
  organizationId: string
}): Promise<ProjectRecord | null> {
  const row = await db.query.project.findFirst({
    where: and(
      eq(project.id, input.id),
      eq(project.organizationId, input.organizationId)
    ),
  })
  return row ? toRecord(row) : null
}

export async function getProjectBySlug(input: {
  slug: string
  organizationId: string
}): Promise<ProjectRecord | null> {
  const row = await db.query.project.findFirst({
    where: and(
      eq(project.slug, input.slug),
      eq(project.organizationId, input.organizationId)
    ),
  })
  return row ? toRecord(row) : null
}

export async function createProject(input: {
  organizationId: string
  name: string
  slug: string
  description?: string | null
}): Promise<ProjectRecord> {
  const slug = requireSlug(input.slug)
  const name = input.name.trim().slice(0, 120)
  if (!name) throw new Error("Project name must not be empty.")

  const [row] = await db
    .insert(project)
    .values({
      id: nanoid(16),
      organizationId: input.organizationId,
      name,
      slug,
      description: input.description?.trim() || null,
    })
    .returning()

  if (!row) throw new Error("Failed to create project.")
  return toRecord(row)
}

export async function updateProject(input: {
  id: string
  organizationId: string
  name?: string
  description?: string | null
}): Promise<ProjectRecord | null> {
  const set: Partial<typeof project.$inferInsert> = {}
  if (input.name !== undefined) set.name = input.name.trim().slice(0, 120)
  if (input.description !== undefined)
    set.description = input.description?.trim() || null

  const [row] = await db
    .update(project)
    .set(set)
    .where(
      and(
        eq(project.id, input.id),
        eq(project.organizationId, input.organizationId)
      )
    )
    .returning()

  return row ? toRecord(row) : null
}

export async function deleteProject(input: {
  id: string
  organizationId: string
}): Promise<void> {
  await db
    .delete(project)
    .where(
      and(
        eq(project.id, input.id),
        eq(project.organizationId, input.organizationId)
      )
    )
}
