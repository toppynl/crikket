import type { Octokit } from "@octokit/core"

const PRIORITY_LABEL_COLORS: Record<string, string> = {
  "priority: critical": "b60205",
  "priority: high": "e4e669",
  "priority: medium": "fbca04",
  "priority: low": "0075ca",
}

export type BugReportForIssue = {
  id: string
  title: string | null
  description: string | null
  priority: string
  tags: string[]
  url: string | null
  deviceInfo: unknown
}

export function mapBugReportToIssue(
  report: BugReportForIssue,
  crikketAppUrl: string
): { title: string; body: string; labels: string[]; labelColors: Record<string, string> } {
  const title = report.title ?? `Bug report from ${report.url ?? "unknown page"}`

  const deviceInfo = report.deviceInfo as Record<string, unknown> | null
  const deviceSection = deviceInfo
    ? `## Device Info\n\n| Field | Value |\n|---|---|\n${Object.entries(deviceInfo)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `| ${k} | ${String(v)} |`)
        .join("\n")}`
    : ""

  const sections = [
    report.description ? `## Description\n\n${report.description}` : "",
    report.url ? `**Page URL:** ${report.url}` : "",
    deviceSection,
    `---\n[View in Crikket](${crikketAppUrl}/s/${report.id})`,
  ].filter(Boolean)

  const body = sections.join("\n\n")

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

export async function ensureLabelsExist(
  octokit: Octokit,
  owner: string,
  repo: string,
  labels: string[],
  labelColors: Record<string, string>
): Promise<void> {
  const { data: existing } = await octokit.request("GET /repos/{owner}/{repo}/labels", {
    owner,
    repo,
    per_page: 100,
  })
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
