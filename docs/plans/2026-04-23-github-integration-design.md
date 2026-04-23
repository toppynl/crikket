# GitHub Integration Design

**Date:** 2026-04-23
**Status:** Approved

## Summary

Allow users to manually push Crikket bug reports to GitHub Issues, with webhook-driven status sync back. Integration is configured per organization (default repo) with per-capture-key repo overrides. Authentication uses a GitHub App for security and resilience.

---

## Architecture

A new `packages/github` package owns all GitHub-specific logic, mirroring the `packages/billing` / Polar pattern.

```
packages/github/src/
  client.ts                   — GitHub App installation token manager (Octokit)
  issue-mapper.ts             — maps Crikket bug report → GitHub issue body/labels
  schema.ts                   — DB table definitions (consumed by packages/db)
  webhooks/
    handler.ts                — validates signature, claims event, dispatches
    processors/
      issues-closed.ts
      issues-reopened.ts
```

**Other touchpoints:**
- `packages/db` — imports and re-exports schema from `packages/github`
- `packages/api` — new `github` router (`configure`, `getConfig`, `deleteConfig`, `pushIssue`)
- `packages/env` — new env var entries for GitHub App credentials
- `apps/server` — `POST /api/webhooks/github` + scheduled webhook processor job
- `apps/web` — GitHub settings page + "Push to GitHub" button on bug report detail

---

## Data Model

```ts
githubIntegration {
  id
  organizationId       // FK → organization, cascade delete
  installationId       // GitHub App installation ID
  defaultOwner         // GitHub org/user name
  defaultRepo
  createdAt, updatedAt
}

githubCaptureKeyOverride {
  id
  captureKeyId         // FK → capturePublicKey, cascade delete
  organizationId
  owner
  repo
  createdAt, updatedAt
}

githubIssueLink {
  id
  bugReportId          // FK → bugReport, cascade delete
  organizationId
  owner
  repo
  issueNumber          // integer
  issueUrl
  pushedAt
}

githubWebhookEvent {
  id
  githubDeliveryId     // unique — X-GitHub-Delivery header (idempotency key)
  eventType            // X-GitHub-Event header
  status               // received → processing → processed | ignored | failed
  payload              // jsonb
  attemptCount
  errorMessage
  receivedAt, processedAt, createdAt, updatedAt
}
```

`githubIssueLink` is a separate table (not columns on `bugReport`) so a report can be pushed to multiple repos without schema changes. Installation tokens are minted on demand via the GitHub App — no long-lived per-org secrets.

---

## Push Flow

Triggered by user clicking "Push to GitHub" on a bug report.

```
Web UI
  → orpc.github.pushIssue({ bugReportId })
  → validate session, check org membership

Server procedure
  1. Load bug report (title, description, priority, tags, url, deviceInfo)
  2. Resolve target repo:
       captureKey override → org default → error if neither configured
  3. Load githubIntegration, mint installation token via GitHub App
  4. Map to GitHub issue:
       title:  bug report title (fallback: "Bug report from <url>")
       body:   description + device info table + Crikket deep-link
       labels: priority:<value> + tags (create labels if missing)
  5. POST /repos/{owner}/{repo}/issues via Octokit
  6. Insert githubIssueLink row
  7. Return { issueUrl, issueNumber }

Web UI
  → button changes to "View on GitHub ↗"
```

**Label mapping:**

| Crikket priority | GitHub label |
|---|---|
| `critical` | `priority: critical` (red) |
| `high` | `priority: high` (orange) |
| `medium` | `priority: medium` (yellow) |
| `low` | `priority: low` (blue) |
| `none` | _(no label)_ |

Tags map 1:1 as GitHub labels, created on the repo if missing.

**Error cases:**
- Integration not configured → `BAD_REQUEST` with link to settings
- Already pushed → return existing `githubIssueLink` (idempotent, no duplicate issues)
- GitHub API error → surface to user, nothing persisted

---

## Status Sync (Webhook-driven)

```
GitHub App webhook → POST /api/webhooks/github

Handler
  1. Verify X-Hub-Signature-256 (HMAC-SHA256, GITHUB_WEBHOOK_SECRET)
  2. Insert githubWebhookEvent with unique githubDeliveryId
     → conflict = already received, return 200 immediately
  3. Return 200 (fast ACK)

Background processor (runs every 60s)
  1. Claim pending githubWebhookEvent (pending → processing)
  2. Dispatch on action:
       issues.closed   → find githubIssueLink → set bugReport.status = "resolved"
       issues.reopened → set bugReport.status = "open"
       issues.*        → mark "ignored"
  3. Mark "processed" or "failed" with retry (same pattern as billing webhooks)
```

**Status mapping:**

| GitHub event | Crikket status |
|---|---|
| `issues.closed` | `resolved` |
| `issues.reopened` | `open` |

**Edge cases:**
- Issue closed on unlinked repo → `ignored`
- Bug report already `closed` manually → no-op
- Duplicate delivery from GitHub → idempotent via `githubDeliveryId`

---

## GitHub App Configuration

**One-time registration (Crikket-owned app):**
- Permissions: `Issues: Read & Write`, `Metadata: Read-only`
- Events subscribed: `Issues` only
- Callback URL: `https://<server>/api/github/callback`
- Webhook URL: `https://<server>/api/webhooks/github`

**New env vars (`packages/env`):**
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY` (PEM, base64-encoded)
- `GITHUB_WEBHOOK_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

---

## UI

**Org settings (`/settings/integrations/github`):**
- "Connect GitHub" button → GitHub App install flow → callback stores `githubIntegration`
- Once connected: show installation name, default repo dropdown (via GitHub API), disconnect button

**Per-capture-key settings:**
- Optional repo override (owner + repo fields)

**Bug report detail:**
- Before push: "Push to GitHub" button
- After push: "View on GitHub ↗" link + synced status badge (updates only on webhook arrival, no polling)
