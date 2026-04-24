import { db } from "@crikket/db"
import { githubIntegration } from "@crikket/db/schema/github"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { getInstallationDetails } from "../client"

export async function configureGitHubIntegration(
  organizationId: string,
  installationId: string,
  defaultRepo: string,
  autoSync?: boolean
): Promise<void> {
  const details = await getInstallationDetails(installationId)
  const account = details.account as { login?: string } | null | undefined
  const defaultOwner = account?.login

  if (!defaultOwner) {
    throw new Error("Could not resolve owner from GitHub installation")
  }

  await db
    .insert(githubIntegration)
    .values({
      id: nanoid(),
      organizationId,
      installationId,
      defaultOwner,
      defaultRepo,
      autoSync: autoSync ?? false,
    })
    .onConflictDoUpdate({
      target: githubIntegration.organizationId,
      set: {
        installationId,
        defaultOwner,
        defaultRepo,
        ...(autoSync !== undefined ? { autoSync } : {}),
        updatedAt: new Date(),
      },
    })
}

export async function deleteGitHubIntegration(
  organizationId: string
): Promise<void> {
  await db
    .delete(githubIntegration)
    .where(eq(githubIntegration.organizationId, organizationId))
}

export async function getGitHubIntegration(organizationId: string) {
  const [integration] = await db
    .select()
    .from(githubIntegration)
    .where(eq(githubIntegration.organizationId, organizationId))
    .limit(1)

  return integration ?? null
}
