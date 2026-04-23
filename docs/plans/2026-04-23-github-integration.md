# GitHub Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to manually push Crikket bug reports to GitHub Issues, with webhook-driven status sync back — per-org default repo with per-capture-key overrides, authenticated via GitHub App.

**Architecture:** New `packages/github` package mirrors `packages/billing`. DB schema lives in `packages/db/src/schema/github.ts` (same pattern as billing). ORPC procedures in `packages/github` wired into `packages/api`. GitHub webhook endpoint added to `apps/server`. Next.js Route Handler + settings page + push button in `apps/web`.

**Tech Stack:** Bun, TypeScript, Drizzle ORM (PostgreSQL), ORPC, Hono, `@octokit/app`, Next.js 16, Tailwind/Shadcn

---

### Task 1: Add `@octokit/app` to catalog + new env vars

**Files:**
- Modify: `package.json` (root — `workspaces.catalog`)
- Modify: `packages/env/src/server.ts`
- Modify: `packages/env/src/web.ts`

**Step 1: Add `@octokit/app` to pnpm catalog**

In `package.json` under `workspaces.catalog`, add one entry:
```json
"@octokit/app": "^15.1.0"
```

**Step 2: Add server env vars**

In `packages/env/src/server.ts`, add to the `server` schema object:
```typescript
GITHUB_APP_ID: z.string().min(1).optional(),
GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
GITHUB_CLIENT_ID: z.string().min(1).optional(),
GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
```

Add the same keys to `runtimeEnv`:
```typescript
GITHUB_APP_ID: process.env.GITHUB_APP_ID,
GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY,
GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,
GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
```

**Step 3: Add web env var**

In `packages/env/src/web.ts`, add to `client`:
```typescript
NEXT_PUBLIC_GITHUB_APP_SLUG: z.string().optional(),
```

Add to `runtimeEnv`:
```typescript
NEXT_PUBLIC_GITHUB_APP_SLUG: process.env.NEXT_PUBLIC_GITHUB_APP_SLUG,
```

**Step 4: Verify**

Run: `bun run check-types`
Expected: passes (all new vars are optional)

**Step 5: Commit**

```bash
git add package.json packages/env/src/server.ts packages/env/src/web.ts
git commit -m "feat(github): add octokit to catalog and GitHub env vars"
```

---

### Task 2: Create DB schema

**Files:**
- Create: `packages/db/src/schema/github.ts`
- Modify: `packages/db/src/schema/index.ts`

**Step 1: Create `packages/db/src/schema/github.ts`**

```typescript
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core"
import { organization } from "./auth"
import { bugReport, capturePublicKey } from "./bug-report"

export const githubIntegration = pgTable(
  "github_integration",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    installationId: text("installation_id").notNull(),
    defaultOwner: text("default_owner").notNull(),
    defaultRepo: text("default_repo").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("github_integration_org_unique").on(table.organizationId),
    index("github_integration_org_idx").on(table.organizationId),
  ]
)

export const githubCaptureKeyOverride = pgTable(
  "github_capture_key_override",
  {
    id: text("id").primaryKey(),
    captureKeyId: text("capture_key_id")
      .notNull()
      .unique()
      .references(() => capturePublicKey.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").notNull(),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("github_capture_key_override_org_idx").on(table.organizationId),
  ]
)

export const githubIssueLink = pgTable(
  "github_issue_link",
  {
    id: text("id").primaryKey(),
    bugReportId: text("bug_report_id")
      .notNull()
      .references(() => bugReport.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").notNull(),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    issueNumber: integer("issue_number").notNull(),
    issueUrl: text("issue_url").notNull(),
    pushedAt: timestamp("pushed_at").defaultNow().notNull(),
  },
  (table) => [
    index("github_issue_link_bug_report_idx").on(table.bugReportId),
    index("github_issue_link_org_idx").on(table.organizationId),
  ]
)

export const githubWebhookEvent = pgTable(
  "github_webhook_event",
  {
    id: text("id").primaryKey(),
    githubDeliveryId: text("github_delivery_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    status: text("status").default("received").notNull(),
    payload: jsonb("payload").notNull(),
    attemptCount: integer("attempt_count").default(1).notNull(),
    errorMessage: text("error_message"),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("github_webhook_event_status_idx").on(table.status),
    index("github_webhook_event_type_idx").on(table.eventType),
  ]
)
```

**Step 2: Export from schema index**

In `packages/db/src/schema/index.ts`, add:
```typescript
export * from "./github"
```

**Step 3: Run migration**

Run: `bun run db:push`
Expected: 4 new tables created in the database

**Step 4: Verify types**

Run: `bun run check-types`
Expected: passes

**Step 5: Commit**

```bash
git add packages/db/src/schema/github.ts packages/db/src/schema/index.ts
git commit -m "feat(github): add DB schema for github integration (4 tables)"
```

---

### Task 3: Create `packages/github` scaffold and GitHub App client

**Files:**
- Create: `packages/github/package.json`
- Create: `packages/github/tsconfig.json`
- Create: `packages/github/src/index.ts`
- Create: `packages/github/src/client.ts`

**Step 1: Create `packages/github/package.json`**

```json
{
  "name": "@crikket/github",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    "./*": {
      "default": "./src/*.ts"
    }
  },
  "dependencies": {
    "@crikket/db": "workspace:*",
    "@crikket/env": "workspace:*",
    "@crikket/shared": "workspace:*",
    "@octokit/app": "catalog:",
    "@orpc/server": "catalog:",
    "drizzle-orm": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@crikket/config": "workspace:*",
    "typescript": "catalog:"
  }
}
```

**Step 2: Create `packages/github/tsconfig.json`**

```json
{
  "extends": "@crikket/config/tsconfig.base.json",
  "compilerOptions": {
    "strictNullChecks": true
  },
  "include": ["src/**/*"]
}
```

**Step 3: Create `packages/github/src/index.ts`**

```typescript
export {}
```

**Step 4: Install**

Run: `bun install`

**Step 5: Create `packages/github/src/client.ts`**

```typescript
import { App } from "@octokit/app"
import { env } from "@crikket/env/server"

let _app: App | null = null

function getApp(): App {
  if (_app) return _app
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
    throw new Error("GitHub App not configured (missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY)")
  }
  _app = new App({
    appId: env.GITHUB_APP_ID,
    privateKey: Buffer.from(env.GITHUB_APP_PRIVATE_KEY, "base64").toString("utf8"),
  })
  return _app
}

export async function getInstallationOctokit(installationId: string) {
  return getApp().getInstallationOctokit(Number(installationId))
}

export async function getInstallationDetails(installationId: string) {
  const { data } = await getApp().octokit.request(
    "GET /app/installations/{installation_id}",
    { installation_id: Number(installationId) }
  )
  return data
}
```

**Step 6: Verify types**

Run: `bun run check-types`
Expected: passes

**Step 7: Commit**

```bash
git add packages/github/
git commit -m "feat(github): scaffold packages/github with App client"
```

---

### Task 4: Create issue mapper

**Files:**
- Create: `packages/github/src/issue-mapper.ts`

**Step 1: Create `packages/github/src/issue-mapper.ts`**

```typescript
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
  octokit: Awaited<ReturnType<typeof import("@octokit/app").App.prototype.getInstallationOctokit>>,
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
        .catch(() => {})
    }
  }
}
```

Note: The `ensureLabelsExist` function signature uses a complex inferred type for `octokit`. If TypeScript complains, replace the parameter type with `any` for now and add a `// TODO: use proper Octokit type` comment.

**Step 2: Verify types**

Run: `bun run check-types`

**Step 3: Commit**

```bash
git add packages/github/src/issue-mapper.ts
git commit -m "feat(github): add issue mapper (bug report → GitHub issue)"
```

---

### Task 5: Create service functions

**Files:**
- Create: `packages/github/src/service/push-issue.ts`
- Create: `packages/github/src/service/configure.ts`

**Step 1: Create `packages/github/src/service/push-issue.ts`**

```typescript
import { db } from "@crikket/db"
import {
  bugReport,
  githubIntegration,
  githubIssueLink,
} from "@crikket/db/schema"
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
  // Return existing link if already pushed (idempotent)
  const [existing] = await db
    .select()
    .from(githubIssueLink)
    .where(eq(githubIssueLink.bugReportId, bugReportId))
    .limit(1)

  if (existing) {
    return {
      issueUrl: existing.issueUrl,
      issueNumber: existing.issueNumber,
      alreadyPushed: true,
    }
  }

  // Load bug report
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

  // Load org GitHub integration
  const [integration] = await db
    .select()
    .from(githubIntegration)
    .where(eq(githubIntegration.organizationId, organizationId))
    .limit(1)

  if (!integration) {
    throw new Error("GitHub integration not configured for this organization")
  }

  const { owner, repo } = { owner: integration.defaultOwner, repo: integration.defaultRepo }

  // Map bug report to GitHub issue
  const crikketAppUrl = env.BETTER_AUTH_URL // fallback — ideally NEXT_PUBLIC_APP_URL but that's web-only
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

  // Get installation Octokit
  const octokit = await getInstallationOctokit(integration.installationId)

  // Ensure labels exist on repo
  await ensureLabelsExist(octokit as any, owner, repo, labels, labelColors)

  // Create the issue
  const { data: issue } = await octokit.request(
    "POST /repos/{owner}/{repo}/issues",
    { owner, repo, title, body, labels }
  )

  // Store the link
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
```

**Step 2: Create `packages/github/src/service/configure.ts`**

```typescript
import { db } from "@crikket/db"
import { githubIntegration } from "@crikket/db/schema"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { getInstallationDetails } from "../client"

export async function configureGitHubIntegration(
  organizationId: string,
  installationId: string,
  defaultRepo: string
): Promise<void> {
  const details = await getInstallationDetails(installationId)
  const defaultOwner = details.account?.login

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
    })
    .onConflictDoUpdate({
      target: githubIntegration.organizationId,
      set: {
        installationId,
        defaultOwner,
        defaultRepo,
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
```

**Step 3: Verify types**

Run: `bun run check-types`
Expected: passes (if `nanoid` import complains, add `"nanoid": "catalog:"` to `packages/github/package.json` deps)

**Step 4: Commit**

```bash
git add packages/github/src/service/
git commit -m "feat(github): add push-issue and configure service functions"
```

---

### Task 6: Create ORPC procedures and API router

**Files:**
- Create: `packages/github/src/procedures/context.ts`
- Create: `packages/github/src/procedures/push-issue.ts`
- Create: `packages/github/src/procedures/configure.ts`
- Create: `packages/github/src/procedures/get-config.ts`
- Create: `packages/github/src/procedures/delete-config.ts`
- Create: `packages/api/src/routers/github.ts`
- Modify: `packages/api/src/routers/index.ts`
- Modify: `packages/api/package.json`

**Step 1: Create `packages/github/src/procedures/context.ts`**

```typescript
import { createSessionProcedures } from "@crikket/shared/lib/server/orpc-auth"

export type GitHubSessionContext = {
  user: { id: string }
  session: { activeOrganizationId?: string | null }
}

const { protectedProcedure } = createSessionProcedures<GitHubSessionContext>({
  isAuthorized: (session) => Boolean(session?.user?.id),
})

export { protectedProcedure }
```

**Step 2: Create `packages/github/src/procedures/push-issue.ts`**

```typescript
import { ORPCError } from "@orpc/server"
import { z } from "zod"
import { pushBugReportToGitHub } from "../service/push-issue"
import { protectedProcedure } from "./context"

export const pushIssue = protectedProcedure
  .input(z.object({ bugReportId: z.string() }))
  .handler(async ({ context, input }) => {
    const organizationId = context.session.activeOrganizationId
    if (!organizationId) {
      throw new ORPCError({ code: "UNAUTHORIZED", message: "No active organization" })
    }

    try {
      return await pushBugReportToGitHub(input.bugReportId, organizationId)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      if (message.includes("not configured")) {
        throw new ORPCError({
          code: "BAD_REQUEST",
          message: "GitHub integration not configured. Go to Settings → Integrations → GitHub.",
        })
      }
      throw new ORPCError({ code: "INTERNAL_SERVER_ERROR", message })
    }
  })
```

**Step 3: Create `packages/github/src/procedures/configure.ts`**

```typescript
import { ORPCError } from "@orpc/server"
import { z } from "zod"
import { configureGitHubIntegration } from "../service/configure"
import { protectedProcedure } from "./context"

export const configure = protectedProcedure
  .input(
    z.object({
      installationId: z.string(),
      defaultRepo: z.string().min(1),
    })
  )
  .handler(async ({ context, input }) => {
    const organizationId = context.session.activeOrganizationId
    if (!organizationId) {
      throw new ORPCError({ code: "UNAUTHORIZED", message: "No active organization" })
    }

    try {
      await configureGitHubIntegration(
        organizationId,
        input.installationId,
        input.defaultRepo
      )
    } catch (error) {
      throw new ORPCError({
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : "Failed to configure GitHub integration",
      })
    }
  })
```

**Step 4: Create `packages/github/src/procedures/get-config.ts`**

```typescript
import { z } from "zod"
import { getGitHubIntegration } from "../service/configure"
import { protectedProcedure } from "./context"

export const getConfig = protectedProcedure
  .input(z.object({}).optional())
  .handler(async ({ context }) => {
    const organizationId = context.session.activeOrganizationId
    if (!organizationId) return null
    return getGitHubIntegration(organizationId)
  })
```

**Step 5: Create `packages/github/src/procedures/delete-config.ts`**

```typescript
import { ORPCError } from "@orpc/server"
import { z } from "zod"
import { deleteGitHubIntegration } from "../service/configure"
import { protectedProcedure } from "./context"

export const deleteConfig = protectedProcedure
  .input(z.object({}).optional())
  .handler(async ({ context }) => {
    const organizationId = context.session.activeOrganizationId
    if (!organizationId) {
      throw new ORPCError({ code: "UNAUTHORIZED", message: "No active organization" })
    }
    await deleteGitHubIntegration(organizationId)
  })
```

**Step 6: Create `packages/api/src/routers/github.ts`**

```typescript
import { configure } from "@crikket/github/procedures/configure"
import { deleteConfig } from "@crikket/github/procedures/delete-config"
import { getConfig } from "@crikket/github/procedures/get-config"
import { pushIssue } from "@crikket/github/procedures/push-issue"

export const githubRouter = {
  configure,
  deleteConfig,
  getConfig,
  pushIssue,
}
```

**Step 7: Add `githubRouter` to `packages/api/src/routers/index.ts`**

Add the import:
```typescript
import { githubRouter } from "./github"
```

Add to `appRouter`:
```typescript
github: githubRouter,
```

**Step 8: Add `@crikket/github` to `packages/api/package.json`**

In `dependencies`, add:
```json
"@crikket/github": "workspace:*"
```

**Step 9: Verify types**

Run: `bun run check-types`
Expected: passes

**Step 10: Commit**

```bash
git add packages/github/src/procedures/ packages/api/src/routers/github.ts packages/api/src/routers/index.ts packages/api/package.json
git commit -m "feat(github): add ORPC procedures and github API router"
```

---

### Task 7: Create webhook handler and processors

**Files:**
- Create: `packages/github/src/webhooks/handler.ts`
- Create: `packages/github/src/webhooks/processors/issues-closed.ts`
- Create: `packages/github/src/webhooks/processors/issues-reopened.ts`
- Create: `packages/github/src/webhooks/processor.ts`

**Step 1: Create `packages/github/src/webhooks/handler.ts`**

This file handles raw inbound webhook HTTP calls from GitHub: verifies the signature and inserts a `githubWebhookEvent` row for async processing.

```typescript
import { db } from "@crikket/db"
import { githubWebhookEvent } from "@crikket/db/schema"
import { env } from "@crikket/env/server"
import { createHmac, timingSafeEqual } from "node:crypto"
import { nanoid } from "nanoid"

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const hmac = createHmac("sha256", secret)
  hmac.update(payload)
  const expected = Buffer.from(`sha256=${hmac.digest("hex")}`)
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

export async function handleGitHubWebhook(request: Request): Promise<Response> {
  const secret = env.GITHUB_WEBHOOK_SECRET
  if (!secret) {
    return new Response("GitHub webhook not configured", { status: 503 })
  }

  const signature = request.headers.get("x-hub-signature-256") ?? ""
  const deliveryId = request.headers.get("x-github-delivery") ?? ""
  const eventType = request.headers.get("x-github-event") ?? "unknown"

  const payload = await request.text()

  if (!verifySignature(payload, signature, secret)) {
    return new Response("Invalid signature", { status: 401 })
  }

  // Insert with idempotency — duplicate deliveries are silently ignored
  try {
    await db.insert(githubWebhookEvent).values({
      id: nanoid(),
      githubDeliveryId: deliveryId,
      eventType,
      status: "received",
      payload: JSON.parse(payload),
    })
  } catch (error: any) {
    // Unique constraint violation = already received, return 200
    if (error?.code === "23505" || error?.message?.includes("unique")) {
      return new Response("OK", { status: 200 })
    }
    throw error
  }

  return new Response("OK", { status: 200 })
}
```

**Step 2: Create `packages/github/src/webhooks/processors/issues-closed.ts`**

```typescript
import { db } from "@crikket/db"
import { bugReport, githubIssueLink } from "@crikket/db/schema"
import { and, eq } from "drizzle-orm"

type IssuesPayload = {
  action: string
  issue: { number: number }
  repository: { name: string; owner: { login: string } }
}

export async function processIssuesClosed(payload: IssuesPayload): Promise<void> {
  const { issue, repository } = payload
  const owner = repository.owner.login
  const repo = repository.name
  const issueNumber = issue.number

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

  // Only update if not already manually closed
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
```

**Step 3: Create `packages/github/src/webhooks/processors/issues-reopened.ts`**

```typescript
import { db } from "@crikket/db"
import { bugReport, githubIssueLink } from "@crikket/db/schema"
import { and, eq } from "drizzle-orm"

type IssuesPayload = {
  action: string
  issue: { number: number }
  repository: { name: string; owner: { login: string } }
}

export async function processIssuesReopened(payload: IssuesPayload): Promise<void> {
  const { issue, repository } = payload
  const owner = repository.owner.login
  const repo = repository.name
  const issueNumber = issue.number

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
    .set({ status: "open", updatedAt: new Date() })
    .where(
      and(
        eq(bugReport.id, link.bugReportId),
        eq(bugReport.status, "resolved")
      )
    )
}
```

**Step 4: Create `packages/github/src/webhooks/processor.ts`**

This is the background job that drains the `githubWebhookEvent` queue — called on a schedule from `apps/server`.

```typescript
import { db } from "@crikket/db"
import { githubWebhookEvent } from "@crikket/db/schema"
import { and, eq, lt } from "drizzle-orm"
import { processIssuesClosed } from "./processors/issues-closed"
import { processIssuesReopened } from "./processors/issues-reopened"

const STALE_PROCESSING_MS = 5 * 60 * 1000

async function claimNextEvent() {
  const staleThreshold = new Date(Date.now() - STALE_PROCESSING_MS)

  return db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(githubWebhookEvent)
      .where(
        and(
          eq(githubWebhookEvent.status, "received"),
        )
      )
      .limit(1)
      .for("update", { skipLocked: true })

    if (!event) return null

    await tx
      .update(githubWebhookEvent)
      .set({ status: "processing" })
      .where(eq(githubWebhookEvent.id, event.id))

    return event
  })
}

export async function runGitHubWebhookProcessorPass(options: { limit: number } = { limit: 10 }): Promise<void> {
  for (let i = 0; i < options.limit; i++) {
    const event = await claimNextEvent()
    if (!event) break

    try {
      const payload = event.payload as Record<string, unknown>
      const action = (payload as any).action as string | undefined

      if (event.eventType === "issues") {
        if (action === "closed") {
          await processIssuesClosed(payload as any)
        } else if (action === "reopened") {
          await processIssuesReopened(payload as any)
        }
      }

      await db
        .update(githubWebhookEvent)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(githubWebhookEvent.id, event.id))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await db
        .update(githubWebhookEvent)
        .set({
          status: "failed",
          errorMessage: message.slice(0, 2000),
          attemptCount: event.attemptCount + 1,
        })
        .where(eq(githubWebhookEvent.id, event.id))
    }
  }
}
```

**Step 5: Verify types**

Run: `bun run check-types`
Expected: passes

**Step 6: Commit**

```bash
git add packages/github/src/webhooks/
git commit -m "feat(github): add webhook handler and issue status processors"
```

---

### Task 8: Wire into `apps/server`

**Files:**
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/package.json`

**Step 1: Add `@crikket/github` to `apps/server/package.json`**

In `dependencies`, add:
```json
"@crikket/github": "workspace:*"
```

Run: `bun install`

**Step 2: Add imports to `apps/server/src/index.ts`**

At the top of the file, add:
```typescript
import { handleGitHubWebhook } from "@crikket/github/webhooks/handler"
import { runGitHubWebhookProcessorPass } from "@crikket/github/webhooks/processor"
```

**Step 3: Add webhook route**

In `apps/server/src/index.ts`, find the section where the embed routes are registered (e.g., `app.post("/api/embed/...")`). Add after them:

```typescript
app.post("/api/webhooks/github", (c) => handleGitHubWebhook(c.req.raw))
```

**Step 4: Add GitHub App callback route**

The GitHub App callback can simply redirect to the web app settings page. Add:

```typescript
app.get("/api/github/callback", (c) => {
  const installationId = c.req.query("installation_id")
  const setupAction = c.req.query("setup_action")
  const appUrl = env.BETTER_AUTH_URL // use web app URL env var if available
  const redirectUrl = new URL("/settings/integrations/github", appUrl)
  if (installationId) redirectUrl.searchParams.set("installation_id", installationId)
  if (setupAction) redirectUrl.searchParams.set("setup_action", setupAction)
  return c.redirect(redirectUrl.toString())
})
```

Note: If the server has a separate `NEXT_PUBLIC_APP_URL` or similar env var, use that instead of `BETTER_AUTH_URL`. Check `packages/env/src/server.ts` for available vars.

**Step 5: Add scheduled processor job**

Near the other `setInterval` calls in `apps/server/src/index.ts`, add:

```typescript
const GITHUB_WEBHOOK_PROCESSOR_INTERVAL_MS = 30 * 1000 // 30 seconds

setInterval(() => {
  runGitHubWebhookProcessorPass({ limit: 20 }).catch((error) => {
    console.error("[github-webhook-processor] failed scheduled pass", error)
  })
}, GITHUB_WEBHOOK_PROCESSOR_INTERVAL_MS)
```

**Step 6: Verify types**

Run: `bun run check-types`
Expected: passes

**Step 7: Commit**

```bash
git add apps/server/src/index.ts apps/server/package.json
git commit -m "feat(github): wire webhook endpoint and processor into server"
```

---

### Task 9: Web — GitHub settings page

**Files:**
- Create: `apps/web/src/app/(protected)/(dashboard)/settings/integrations/github/page.tsx`
- Create: `apps/web/src/app/(protected)/(dashboard)/settings/integrations/github/_components/github-integration-card.tsx`
- Modify: `apps/web/src/app/(protected)/(dashboard)/settings/_components/settings-navigation.tsx`
- Modify: `apps/web/package.json`

**Step 1: Add `@crikket/github` to `apps/web/package.json`**

In `dependencies`, add:
```json
"@crikket/github": "workspace:*"
```

Run: `bun install`

**Step 2: Add GitHub to settings navigation**

In `apps/web/src/app/(protected)/(dashboard)/settings/_components/settings-navigation.tsx`, add a `Github` import from `lucide-react` and add a new entry to `SETTINGS_ITEMS`:

```typescript
import { Building2, CreditCard, Github, KeyRound, UserRound } from "lucide-react"

// Add to SETTINGS_ITEMS array:
{
  href: "/settings/integrations/github",
  title: "GitHub",
  description: "Push bugs to GitHub Issues",
  icon: Github,
},
```

**Step 3: Create the GitHub integration card component**

Create `apps/web/src/app/(protected)/(dashboard)/settings/integrations/github/_components/github-integration-card.tsx`:

```tsx
"use client"

import { Button } from "@crikket/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crikket/ui/components/ui/card"
import { Input } from "@crikket/ui/components/ui/input"
import { useForm } from "@tanstack/react-form"
import { Github } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { client } from "@/utils/orpc"

type Props = {
  githubAppSlug: string | undefined
  currentConfig: {
    installationId: string
    defaultOwner: string
    defaultRepo: string
  } | null
  organizationId: string
}

export function GitHubIntegrationCard({ githubAppSlug, currentConfig, organizationId }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pendingInstallationId = searchParams.get("installation_id")

  const form = useForm({
    defaultValues: {
      installationId: pendingInstallationId ?? currentConfig?.installationId ?? "",
      defaultRepo: currentConfig?.defaultRepo ?? "",
    },
    onSubmit: async ({ value }) => {
      try {
        await client.github.configure({
          installationId: value.installationId,
          defaultRepo: value.defaultRepo,
        })
        toast.success("GitHub integration saved")
        router.replace("/settings/integrations/github")
        router.refresh()
      } catch {
        toast.error("Failed to save GitHub integration")
      }
    },
  })

  async function handleDisconnect() {
    try {
      await client.github.deleteConfig()
      toast.success("GitHub integration disconnected")
      router.refresh()
    } catch {
      toast.error("Failed to disconnect")
    }
  }

  const installUrl = githubAppSlug
    ? `https://github.com/apps/${githubAppSlug}/installations/new`
    : null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Github className="size-5" />
          <CardTitle>GitHub Issues</CardTitle>
        </div>
        <CardDescription>
          Push bug reports to GitHub Issues and sync their status back automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!currentConfig && !pendingInstallationId && (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Connect your GitHub account to push bug reports as GitHub Issues.
            </p>
            {installUrl ? (
              <Button asChild>
                <a href={installUrl} target="_blank" rel="noreferrer">
                  Install GitHub App
                </a>
              </Button>
            ) : (
              <p className="text-muted-foreground text-xs">
                NEXT_PUBLIC_GITHUB_APP_SLUG is not configured.
              </p>
            )}
          </div>
        )}

        {(currentConfig || pendingInstallationId) && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              form.handleSubmit()
            }}
            className="space-y-4"
          >
            {currentConfig && (
              <p className="text-sm">
                Connected to <strong>{currentConfig.defaultOwner}</strong>
              </p>
            )}

            <form.Field name="installationId">
              {(field) => (
                <input type="hidden" value={field.state.value} />
              )}
            </form.Field>

            <form.Field name="defaultRepo">
              {(field) => (
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="defaultRepo">
                    Default repository
                  </label>
                  <Input
                    id="defaultRepo"
                    placeholder="my-repo"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    Repository name only (e.g. <code>my-repo</code>, not <code>org/my-repo</code>).
                    The owner is resolved from your GitHub App installation.
                  </p>
                </div>
              )}
            </form.Field>

            <div className="flex gap-2">
              <Button type="submit" disabled={form.state.isSubmitting}>
                {form.state.isSubmitting ? "Saving…" : "Save"}
              </Button>
              {currentConfig && (
                <Button type="button" variant="destructive" onClick={handleDisconnect}>
                  Disconnect
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
```

**Step 4: Create the settings page**

Create `apps/web/src/app/(protected)/(dashboard)/settings/integrations/github/page.tsx`:

```tsx
import { env } from "@crikket/env/web"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Suspense } from "react"
import { getProtectedAuthData } from "@/app/(protected)/_lib/get-protected-auth-data"
import { client } from "@/utils/orpc"
import { GitHubIntegrationCard } from "./_components/github-integration-card"

export const metadata: Metadata = {
  title: "GitHub Integration",
  description: "Connect Crikket to GitHub Issues.",
}

export default async function GitHubIntegrationPage() {
  const { organizations, session } = await getProtectedAuthData()

  if (!session) redirect("/login")
  if (organizations.length === 0) redirect("/onboarding")

  const activeOrganization =
    organizations.find((o) => o.id === session.session.activeOrganizationId) ??
    organizations[0]

  const currentConfig = await client.github.getConfig().catch(() => null)

  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-xl">GitHub Integration</h2>
      <Suspense>
        <GitHubIntegrationCard
          githubAppSlug={env.NEXT_PUBLIC_GITHUB_APP_SLUG}
          currentConfig={currentConfig}
          organizationId={activeOrganization.id}
        />
      </Suspense>
    </div>
  )
}
```

**Step 5: Verify types**

Run: `bun run check-types`
Expected: passes

**Step 6: Commit**

```bash
git add "apps/web/src/app/(protected)/(dashboard)/settings/integrations/" "apps/web/src/app/(protected)/(dashboard)/settings/_components/settings-navigation.tsx" apps/web/package.json
git commit -m "feat(github): add GitHub settings page and navigation entry"
```

---

### Task 10: Web — Push to GitHub button on bug report card

**Files:**
- Modify: `apps/web/src/app/(protected)/(dashboard)/_components/bug-reports/bug-report-card.tsx`

**Step 1: Read the current bug-report-card**

Read `apps/web/src/app/(protected)/(dashboard)/_components/bug-reports/bug-report-card.tsx` to find:
- The `DropdownMenu` section (contains actions like copy, edit, delete)
- The props type (to see what data is already available — specifically `id`)

**Step 2: Add state and push handler to the card**

Add the push state near the top of the component:
```tsx
const [githubIssueUrl, setGithubIssueUrl] = React.useState<string | null>(null)
const [isPushing, setIsPushing] = React.useState(false)

async function handlePushToGitHub() {
  setIsPushing(true)
  try {
    const result = await client.github.pushIssue({ bugReportId: report.id })
    setGithubIssueUrl(result.issueUrl)
    toast.success(result.alreadyPushed ? "Already on GitHub" : "Pushed to GitHub")
  } catch (error: any) {
    toast.error(error?.message ?? "Failed to push to GitHub")
  } finally {
    setIsPushing(false)
  }
}
```

**Step 3: Add the menu item to the DropdownMenu**

Find the `DropdownMenuGroup` with actions (copy, edit, delete, etc.) and add:
```tsx
import { Github } from "lucide-react"

// In the DropdownMenuGroup:
{githubIssueUrl ? (
  <DropdownMenuItem asChild>
    <a href={githubIssueUrl} target="_blank" rel="noreferrer">
      <Github className="size-4" />
      View on GitHub
    </a>
  </DropdownMenuItem>
) : (
  <DropdownMenuItem onClick={handlePushToGitHub} disabled={isPushing}>
    <Github className="size-4" />
    {isPushing ? "Pushing…" : "Push to GitHub"}
  </DropdownMenuItem>
)}
```

**Step 4: Import `client` if not already imported**

Check if `client` from `@/utils/orpc` is already imported in the card file. Add if missing:
```typescript
import { client } from "@/utils/orpc"
```

**Step 5: Verify types**

Run: `bun run check-types`
Expected: passes

**Step 6: Verify linting**

Run: `bun run check`
Expected: passes (if not, run `bun run fix` to auto-fix)

**Step 7: Commit**

```bash
git add "apps/web/src/app/(protected)/(dashboard)/_components/bug-reports/bug-report-card.tsx"
git commit -m "feat(github): add Push to GitHub button on bug report card"
```

---

## Manual Testing Checklist

Before considering the feature complete, verify these flows manually with `bun run dev`:

- [ ] **Settings page loads** at `/settings/integrations/github` without errors
- [ ] **GitHub nav entry** appears in the settings sidebar
- [ ] **Install flow**: clicking "Install GitHub App" opens GitHub (requires real `NEXT_PUBLIC_GITHUB_APP_SLUG`)
- [ ] **Callback redirect**: `?installation_id=<id>` appears in the settings URL after install
- [ ] **Save config**: filling in a repo name and clicking Save calls `configure` without error
- [ ] **Push to GitHub**: dropdown menu on a bug report shows "Push to GitHub"; clicking it creates an issue
- [ ] **Idempotency**: pushing the same report twice returns the existing issue (no duplicate)
- [ ] **Status sync**: closing a GitHub issue updates the bug report status to `resolved` (requires real webhook delivery — test via GitHub's webhook delivery re-send in App settings)

## Environment Variables Required

Add these to your `.env` before testing:

```env
# packages/env/src/server.ts
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=   # base64-encoded PEM
GITHUB_WEBHOOK_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# packages/env/src/web.ts (NEXT_PUBLIC_*)
NEXT_PUBLIC_GITHUB_APP_SLUG=   # your GitHub App's slug
```

## GitHub App Registration Checklist

Before testing, register the GitHub App at https://github.com/settings/apps/new with:
- **Permissions:** Issues → Read & Write; Metadata → Read-only
- **Subscribe to events:** Issues
- **Callback URL:** `http://localhost:3000/api/github/callback` (dev) / `https://<server>/api/github/callback` (prod)
- **Webhook URL:** `http://<ngrok-or-smee>/api/webhooks/github` (for local webhook testing, use smee.io or ngrok)
