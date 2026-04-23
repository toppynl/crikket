import { db } from "@crikket/db"
import { projectGithubConfig } from "@crikket/db/schema/github"
import { and, eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { getInstallationDetails } from "../client"

export interface ProjectGithubConfigRecord {
  id: string
  projectId: string
  organizationId: string
  owner: string
  repo: string
  autoSync: boolean
}

export async function getProjectGithubConfig(input: {
  projectId: string
  organizationId: string
}): Promise<ProjectGithubConfigRecord | null> {
  const [row] = await db
    .select()
    .from(projectGithubConfig)
    .where(
      and(
        eq(projectGithubConfig.projectId, input.projectId),
        eq(projectGithubConfig.organizationId, input.organizationId)
      )
    )
    .limit(1)

  return row ?? null
}

export async function upsertProjectGithubConfig(input: {
  projectId: string
  organizationId: string
  installationId: string
  repo: string
  autoSync?: boolean
}): Promise<ProjectGithubConfigRecord> {
  const details = await getInstallationDetails(input.installationId)
  const account = details.account as { login?: string } | null | undefined
  const owner = account?.login
  if (!owner) throw new Error("Could not resolve owner from GitHub installation")

  const [row] = await db
    .insert(projectGithubConfig)
    .values({
      id: nanoid(),
      projectId: input.projectId,
      organizationId: input.organizationId,
      owner,
      repo: input.repo,
      autoSync: input.autoSync ?? false,
    })
    .onConflictDoUpdate({
      target: projectGithubConfig.projectId,
      set: {
        owner,
        repo: input.repo,
        ...(input.autoSync !== undefined ? { autoSync: input.autoSync } : {}),
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!row) throw new Error("Failed to upsert project GitHub config.")
  return row
}

export async function deleteProjectGithubConfig(input: {
  projectId: string
  organizationId: string
}): Promise<void> {
  await db
    .delete(projectGithubConfig)
    .where(
      and(
        eq(projectGithubConfig.projectId, input.projectId),
        eq(projectGithubConfig.organizationId, input.organizationId)
      )
    )
}
