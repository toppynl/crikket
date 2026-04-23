import { db } from "@crikket/db"
import { bugReport } from "@crikket/db/schema/bug-report"
import { githubIntegration, githubIssueLink, projectGithubConfig } from "@crikket/db/schema/github"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { and, eq, gt, notExists } from "drizzle-orm"
import { pushBugReportToGitHub } from "./push-issue"

// Only attempt auto-sync for reports created within this window.
// Avoids retrying permanently-failing reports and prevents processing
// a large backlog on server restart.
const AUTO_SYNC_WINDOW_MS = 10 * 60 * 1000

export async function runGitHubAutoSyncPass(options?: {
  limit?: number
}): Promise<{ processed: number; pushed: number; skipped: number }> {
  const limit = options?.limit ?? 20
  const windowStart = new Date(Date.now() - AUTO_SYNC_WINDOW_MS)

  const orgCandidates = await db
    .select({
      id: bugReport.id,
      organizationId: bugReport.organizationId,
    })
    .from(bugReport)
    .innerJoin(
      githubIntegration,
      and(
        eq(githubIntegration.organizationId, bugReport.organizationId),
        eq(githubIntegration.autoSync, true)
      )
    )
    .where(
      and(
        gt(bugReport.createdAt, windowStart),
        notExists(
          db
            .select({ id: githubIssueLink.id })
            .from(githubIssueLink)
            .where(eq(githubIssueLink.bugReportId, bugReport.id))
        )
      )
    )
    .limit(limit)

  const projectCandidates = await db
    .select({
      id: bugReport.id,
      organizationId: bugReport.organizationId,
    })
    .from(bugReport)
    .innerJoin(
      projectGithubConfig,
      and(
        eq(projectGithubConfig.organizationId, bugReport.organizationId),
        eq(projectGithubConfig.projectId, bugReport.projectId),
        eq(projectGithubConfig.autoSync, true)
      )
    )
    .where(
      and(
        gt(bugReport.createdAt, windowStart),
        notExists(
          db
            .select({ id: githubIssueLink.id })
            .from(githubIssueLink)
            .where(eq(githubIssueLink.bugReportId, bugReport.id))
        )
      )
    )
    .limit(limit)

  // Deduplicate by id (a report may qualify via both org-level and project-level autoSync)
  const seen = new Map<string, { id: string; organizationId: string }>()
  for (const c of [...orgCandidates, ...projectCandidates]) {
    seen.set(c.id, c)
  }
  const candidates = Array.from(seen.values()).slice(0, limit)

  let pushed = 0
  let skipped = 0

  for (const { id, organizationId } of candidates) {
    try {
      const result = await pushBugReportToGitHub(id, organizationId)
      if (result.alreadyPushed) {
        skipped += 1
      } else {
        pushed += 1
        console.info(
          `[github-auto-sync] pushed bug report ${id} → issue #${result.issueNumber}`
        )
      }
    } catch (error) {
      skipped += 1
      reportNonFatalError(
        `[github-auto-sync] failed to push bug report ${id}`,
        error
      )
    }
  }

  return { processed: candidates.length, pushed, skipped }
}
