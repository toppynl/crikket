import type { Octokit } from "@octokit/core"

const MAX_LOG_LINES = 50
const MAX_NETWORK_ROWS = 50
const MAX_ACTION_ROWS = 50
const MAX_MESSAGE_LEN = 400

const PRIORITY_LABEL_COLORS: Record<string, string> = {
  "priority: critical": "b60205",
  "priority: high": "e4e669",
  "priority: medium": "fbca04",
  "priority: low": "0075ca",
}

interface DeviceInfo {
  browser?: string
  os?: string
  viewport?: string
}

interface ReportMetadata {
  duration?: string
  sdkVersion?: string
  submittedVia?: string
}

export type BugReportLog = {
  level: string
  message: string
  timestamp: Date
}

export type BugReportNetworkRequest = {
  method: string
  url: string
  status: number | null
  duration: number | null
}

export type BugReportAction = {
  type: string
  target: string | null
  timestamp: Date
}

export type BugReportForIssue = {
  id: string
  title: string | null
  description: string | null
  priority: string
  tags: string[]
  url: string | null
  deviceInfo: unknown
  metadata: unknown
  attachmentType: string | null
  captureUrl: string | null
  debuggerUrl: string | null
  createdAt: Date
  logs: BugReportLog[]
  networkRequests: BugReportNetworkRequest[]
  actions: BugReportAction[]
}

export function mapBugReportToIssue(
  report: BugReportForIssue,
  crikketAppUrl: string
): {
  title: string
  body: string
  labels: string[]
  labelColors: Record<string, string>
} {
  const title =
    report.title?.trim() ||
    (report.url ? `Bug report from ${report.url}` : `Bug report ${report.id}`)

  const body = renderIssueBody(report, crikketAppUrl)

  const labels: string[] = []
  const labelColors: Record<string, string> = {}

  if (report.priority !== "none") {
    const priorityLabel = `priority: ${report.priority}`
    labels.push(priorityLabel)
    if (PRIORITY_LABEL_COLORS[priorityLabel]) {
      labelColors[priorityLabel] = PRIORITY_LABEL_COLORS[priorityLabel]
    }
  }

  for (const tag of report.tags) {
    labels.push(tag)
  }

  return { title, body, labels, labelColors }
}

function renderIssueBody(
  report: BugReportForIssue,
  crikketAppUrl: string
): string {
  const device = (report.deviceInfo ?? {}) as DeviceInfo
  const metadata = (report.metadata ?? {}) as ReportMetadata
  const sections: string[] = []

  sections.push(
    `> Forwarded from Crikket bug report \`${report.id}\` on ${report.createdAt.toISOString()}\n> [View in Crikket](${crikketAppUrl}/s/${report.id})`
  )

  if (report.description?.trim()) {
    sections.push(`## Description\n\n${report.description.trim()}`)
  }

  sections.push(
    "## Context",
    renderContextTable({
      URL: report.url ?? "—",
      Browser: device.browser ?? "—",
      OS: device.os ?? "—",
      Viewport: device.viewport ?? "—",
      Priority: report.priority,
      Tags: report.tags.length > 0 ? report.tags.join(", ") : "—",
      Attachment: report.attachmentType ?? "—",
      Duration: metadata.duration ?? "—",
      "SDK version": metadata.sdkVersion ?? "—",
      "Submitted via": metadata.submittedVia ?? "—",
    })
  )

  const artifactSection = renderArtifactsSection(report)
  if (artifactSection) {
    sections.push(artifactSection)
  }

  const limitedActions = report.actions.slice(0, MAX_ACTION_ROWS)
  if (limitedActions.length > 0) {
    const steps = limitedActions
      .map((a, i) => {
        const label = a.target ? `${a.type} on ${a.target}` : a.type
        return `${i + 1}. ${label}`
      })
      .join("\n")
    sections.push(`## Reproduction steps\n\n${steps}`)
  }

  const limitedLogs = report.logs.slice(-MAX_LOG_LINES)
  if (limitedLogs.length > 0) {
    const lines = limitedLogs
      .map(
        (log) =>
          `[${log.timestamp.toISOString()}] ${log.level.toUpperCase()}: ${truncate(log.message)}`
      )
      .join("\n")
    sections.push(`## Console logs\n\n\`\`\`\n${lines}\n\`\`\``)
  }

  const limitedRequests = report.networkRequests.slice(0, MAX_NETWORK_ROWS)
  if (limitedRequests.length > 0) {
    sections.push(
      `<details><summary>Network requests (${limitedRequests.length})</summary>\n\n${renderNetworkTable(limitedRequests)}\n\n</details>`
    )
  }

  return sections.join("\n\n")
}

function renderContextTable(fields: Record<string, string>): string {
  const rows = Object.entries(fields)
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join("\n")
  return `| Field | Value |\n|---|---|\n${rows}`
}

function renderArtifactsSection(report: BugReportForIssue): string | null {
  if (!report.captureUrl && !report.debuggerUrl) {
    return null
  }

  const captureLabel =
    report.attachmentType === "video" ? "Recording (.webm)" : "Screenshot (.png)"
  const captureCell = report.captureUrl
    ? `[${captureLabel}](${report.captureUrl})`
    : "not available"
  const debuggerCell = report.debuggerUrl
    ? `[Debugger payload (.json)](${report.debuggerUrl})`
    : "not available"

  const table = `| Artifact | Link |\n|---|---|\n| ${captureLabel} | ${captureCell} |\n| Debugger payload | ${debuggerCell} |`
  const note =
    "_Artifact links use presigned S3 URLs. Links are valid for 1 year by default, or permanently if the bucket is configured with a public URL._"

  return `## Artifacts\n\n${table}\n\n${note}`
}

function renderNetworkTable(
  requests: BugReportNetworkRequest[]
): string {
  const header = "| Method | Status | Duration (ms) | URL |\n|---|---|---|---|"
  const rows = requests
    .map(
      (r) =>
        `| ${r.method} | ${r.status ?? "—"} | ${r.duration ?? "—"} | ${r.url} |`
    )
    .join("\n")
  return `${header}\n${rows}`
}

function truncate(message: string): string {
  return message.length > MAX_MESSAGE_LEN
    ? `${message.slice(0, MAX_MESSAGE_LEN)}…`
    : message
}

export async function ensureLabelsExist(
  octokit: Octokit,
  owner: string,
  repo: string,
  labels: string[],
  labelColors: Record<string, string>
): Promise<void> {
  const { data: existing } = await octokit.request(
    "GET /repos/{owner}/{repo}/labels",
    {
      owner,
      repo,
      per_page: 100,
    }
  )
  const existingNames = new Set(existing.map((l: { name: string }) => l.name))

  for (const label of labels) {
    if (!existingNames.has(label)) {
      await octokit
        .request("POST /repos/{owner}/{repo}/labels", {
          owner,
          repo,
          name: label,
          color: labelColors[label] ?? "ededed",
        })
        .catch((err: unknown) => {
          if ((err as { status?: number }).status !== 422) throw err
        })
    }
  }
}
