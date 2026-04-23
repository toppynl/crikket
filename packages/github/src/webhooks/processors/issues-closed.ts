import { db } from "@crikket/db"
import { bugReport } from "@crikket/db/schema/bug-report"
import { githubIssueLink } from "@crikket/db/schema/github"
import { and, eq } from "drizzle-orm"

type IssuesPayload = {
  issue: { number: number }
  repository: { name: string; owner: { login: string } }
}

export async function processIssuesClosed(payload: IssuesPayload): Promise<void> {
  const owner = payload.repository.owner.login
  const repo = payload.repository.name
  const issueNumber = payload.issue.number

  const [link] = await db
    .select()
    .from(githubIssueLink)
    .where(
      and(
        eq(githubIssueLink.owner, owner),
        eq(githubIssueLink.repo, repo),
        eq(githubIssueLink.issueNumber, issueNumber)
      )
    )
    .limit(1)

  if (!link) return

  await db
    .update(bugReport)
    .set({ status: "resolved", updatedAt: new Date() })
    .where(
      and(
        eq(bugReport.id, link.bugReportId),
        eq(bugReport.status, "open")
      )
    )
}
