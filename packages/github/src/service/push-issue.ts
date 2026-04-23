import { db } from "@crikket/db"
import { bugReport } from "@crikket/db/schema/bug-report"
import { githubIntegration, githubIssueLink } from "@crikket/db/schema/github"
import { env } from "@crikket/env/server"
import { and, eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { getInstallationOctokit } from "../client"
import { ensureLabelsExist, mapBugReportToIssue } from "../issue-mapper"

export type PushIssueResult = {
  issueUrl: string
  issueNumber: number
  alreadyPushed: boolean
}

export async function pushBugReportToGitHub(
  bugReportId: string,
  organizationId: string
): Promise<PushIssueResult> {
  const [existing] = await db
    .select()
    .from(githubIssueLink)
    .where(
      and(
        eq(githubIssueLink.bugReportId, bugReportId),
        eq(githubIssueLink.organizationId, organizationId)
      )
    )
    .limit(1)

  if (existing) {
    return {
      issueUrl: existing.issueUrl,
      issueNumber: existing.issueNumber,
      alreadyPushed: true,
    }
  }

  const [report] = await db
    .select()
    .from(bugReport)
    .where(
      and(
        eq(bugReport.id, bugReportId),
        eq(bugReport.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!report) {
    throw new Error("Bug report not found")
  }

  const [integration] = await db
    .select()
    .from(githubIntegration)
    .where(eq(githubIntegration.organizationId, organizationId))
    .limit(1)

  if (!integration) {
    throw new Error("GitHub integration not configured for this organization")
  }

  const owner = integration.defaultOwner
  const repo = integration.defaultRepo

  const crikketAppUrl = env.NEXT_PUBLIC_APP_URL ?? ""
  const { title, body, labels, labelColors } = mapBugReportToIssue(
    {
      id: report.id,
      title: report.title,
      description: report.description,
      priority: report.priority,
      tags: report.tags ?? [],
      url: report.url,
      deviceInfo: report.deviceInfo,
    },
    crikketAppUrl
  )

  const octokit = await getInstallationOctokit(integration.installationId)

  await ensureLabelsExist(octokit, owner, repo, labels, labelColors)

  const { data: issue } = await octokit.request(
    "POST /repos/{owner}/{repo}/issues",
    { owner, repo, title, body, labels }
  )

  await db.insert(githubIssueLink).values({
    id: nanoid(),
    bugReportId,
    organizationId,
    owner,
    repo,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
  })

  return {
    issueUrl: issue.html_url,
    issueNumber: issue.number,
    alreadyPushed: false,
  }
}
