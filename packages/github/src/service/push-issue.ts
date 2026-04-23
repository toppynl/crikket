import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { db } from "@crikket/db"
import { bugReport } from "@crikket/db/schema/bug-report"
import { githubIntegration, githubIssueLink, projectGithubConfig } from "@crikket/db/schema/github"
import { env } from "@crikket/env/server"
import { and, asc, eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { getInstallationOctokit } from "../client"
import { ensureLabelsExist, mapBugReportToIssue } from "../issue-mapper"

const DEFAULT_ARTIFACT_URL_TTL_SECONDS = 31_536_000

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

  const report = await db.query.bugReport.findFirst({
    where: and(
      eq(bugReport.id, bugReportId),
      eq(bugReport.organizationId, organizationId)
    ),
    with: {
      logs: {
        orderBy: (t) => [asc(t.timestamp)],
        limit: 50,
      },
      networkRequests: {
        orderBy: (t) => [asc(t.timestamp)],
        limit: 50,
      },
      actions: {
        orderBy: (t) => [asc(t.timestamp)],
        limit: 50,
      },
    },
  })

  if (!report) {
    throw new Error("Bug report not found")
  }

  let owner: string
  let repo: string
  let installationId: string

  const orgIntegration = await db
    .select()
    .from(githubIntegration)
    .where(eq(githubIntegration.organizationId, organizationId))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!orgIntegration) {
    throw new Error("GitHub integration not configured")
  }

  installationId = orgIntegration.installationId

  if (report.projectId) {
    const projConfig = await db
      .select()
      .from(projectGithubConfig)
      .where(
        and(
          eq(projectGithubConfig.projectId, report.projectId),
          eq(projectGithubConfig.organizationId, organizationId)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)

    if (projConfig) {
      owner = projConfig.owner
      repo = projConfig.repo
    } else {
      owner = orgIntegration.defaultOwner
      repo = orgIntegration.defaultRepo
    }
  } else {
    owner = orgIntegration.defaultOwner
    repo = orgIntegration.defaultRepo
  }

  const ttl =
    env.GITHUB_ISSUE_ARTIFACT_URL_TTL_SECONDS ?? DEFAULT_ARTIFACT_URL_TTL_SECONDS

  const [captureUrl, debuggerUrl] = await Promise.all([
    resolveArtifactUrl(report.captureKey ?? null, ttl),
    resolveArtifactUrl(report.debuggerKey ?? null, ttl),
  ])

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
      metadata: report.metadata,
      attachmentType: report.attachmentType,
      captureUrl,
      debuggerUrl,
      createdAt: report.createdAt,
      logs: report.logs,
      networkRequests: report.networkRequests,
      actions: report.actions,
    },
    crikketAppUrl
  )

  const octokit = await getInstallationOctokit(installationId)

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

async function resolveArtifactUrl(
  key: string | null,
  ttlSeconds: number
): Promise<string | null> {
  if (!key) return null

  if (env.STORAGE_PUBLIC_URL) {
    const base = env.STORAGE_PUBLIC_URL.replace(/\/$/, "")
    const encodedKey = key
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/")
    return `${base}/${encodedKey}`
  }

  if (
    !env.STORAGE_BUCKET ||
    !env.STORAGE_ACCESS_KEY_ID ||
    !env.STORAGE_SECRET_ACCESS_KEY
  ) {
    return null
  }

  const region =
    env.STORAGE_REGION ?? (env.STORAGE_ENDPOINT ? "auto" : "us-east-1")
  const forcePathStyle = resolveForcePathStyle(env.STORAGE_ENDPOINT)

  const client = new S3Client({
    region,
    endpoint: env.STORAGE_ENDPOINT,
    forcePathStyle,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    },
  })

  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key }),
    { expiresIn: ttlSeconds }
  )
}

function resolveForcePathStyle(endpoint: string | undefined): boolean {
  if (!endpoint) return false
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase()
    if (hostname.endsWith(".r2.cloudflarestorage.com")) return true
    if (hostname.endsWith(".amazonaws.com")) return false
    return true
  } catch {
    return false
  }
}
