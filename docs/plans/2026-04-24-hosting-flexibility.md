# Hosting Flexibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Node.js-specific modules, swap the DB driver to postgres.js, externalize background jobs into platform-specific adapters, and add deployment configs for Cloudflare Workers, Lambda, and Cloud Run — while keeping the existing self-hosted path fully working.

**Architecture:** Five workstreams executed in order due to dependencies: (1) DB driver swap (pg → postgres.js + `initDb` factory), (2) Web API refactor (crypto.subtle, DecompressionStream, is-ip), (3) env abstraction (createServerEnv factory + BACKGROUND_JOBS var), (4) jobs extraction (packages/jobs + four platform adapters), (5) deployment configs. The existing self-hosted path is preserved via `BACKGROUND_JOBS=native`.

**Tech Stack:** postgres.js (`drizzle-orm/postgres-js`), is-ip, Web Crypto API (`crypto.subtle`), Web Streams API (`DecompressionStream`), Cloudflare Workers + Hyperdrive, AWS Lambda + EventBridge, Google Cloud Run Jobs + Cloud Scheduler

---

### Task 1: Swap database driver to postgres.js

**Files:**
- Modify: `packages/db/package.json`
- Modify: `packages/db/src/index.ts`

**Step 1: Replace dependency in packages/db/package.json**

Remove `pg` from dependencies and `@types/pg` from devDependencies. Add `postgres`:

```json
{
  "name": "@crikket/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "default": "./src/index.ts" },
    "./*": { "default": "./src/*.ts" }
  },
  "scripts": {
    "db:push": "drizzle-kit push",
    "db:generate": "drizzle-kit generate",
    "db:studio": "drizzle-kit studio",
    "db:migrate": "drizzle-kit migrate",
    "check-types": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@crikket/env": "workspace:*",
    "dotenv": "catalog:",
    "drizzle-orm": "catalog:",
    "postgres": "^3.4.5",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@crikket/config": "workspace:*",
    "drizzle-kit": "^0.31.8",
    "typescript": "catalog:"
  }
}
```

Also remove `"@types/pg": "catalog:"` from `packages/api/package.json` dependencies (it was there by mistake).

**Step 2: Rewrite packages/db/src/index.ts**

```ts
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"

import * as schema from "./schema"

export type Database = ReturnType<typeof drizzle<typeof schema>>

// `prepare: false` is required for Cloudflare Hyperdrive, which does not
// support prepared statements. It has negligible impact on regular Postgres.
export function createDb(connectionString: string): Database {
  return drizzle(postgres(connectionString, { prepare: false }), { schema })
}

let _db: Database | undefined

// For Cloudflare Workers: call initDb(env.DB.connectionString) at the
// start of each fetch/scheduled handler before any db access.
export function initDb(connectionString: string): void {
  _db = createDb(connectionString)
}

// Lazy-initialized singleton for traditional targets (Bun, Node.js, Lambda,
// Cloud Run). Reads DATABASE_URL from process.env on first access.
export const db: Database = new Proxy({} as Database, {
  get(_, prop) {
    if (!_db) {
      const url =
        typeof process !== "undefined" ? process.env?.DATABASE_URL : undefined
      if (!url) {
        throw new Error(
          "DB not initialized. Call initDb() or set DATABASE_URL."
        )
      }
      _db = createDb(url)
    }
    return Reflect.get(_db, prop, _db)
  },
})
```

**Step 3: Install dependencies**

```bash
cd /var/www/forks/crikket && bun install
```

Expected: `postgres` package installed, no errors.

**Step 4: Type check**

```bash
bun run check-types --filter @crikket/db
```

Expected: no TypeScript errors. If you see errors about missing `postgres` types, ensure `postgres` is installed.

**Step 5: Commit**

```bash
git add packages/db/ packages/api/package.json
git commit -m "feat: swap database driver from pg to postgres.js with initDb factory"
```

---

### Task 2: Replace node:net and node:crypto in rate-limit.ts

**Files:**
- Modify: `packages/api/package.json`
- Modify: `packages/api/src/rate-limit.ts`

**Step 1: Add is-ip to packages/api/package.json**

Add `"is-ip": "^3.1.0"` to the `dependencies` section.

**Step 2: Replace imports at top of rate-limit.ts**

Remove:
```ts
import { createHash } from "node:crypto"
import { isIP } from "node:net"
```

Add:
```ts
import isIp from "is-ip"
```

**Step 3: Replace isIP call in normalizeIpCandidate**

Change the last line of `normalizeIpCandidate`:
```ts
  return isIP(candidate) ? candidate : null
```
to:
```ts
  return isIp(candidate) ? candidate : null
```

**Step 4: Make getFallbackFingerprint async using crypto.subtle**

Replace the entire `getFallbackFingerprint` function:

```ts
async function getFallbackFingerprint(request: Request): Promise<string> {
  const source = [
    request.headers.get("user-agent")?.trim() ?? "",
    request.headers.get("accept-language")?.trim() ?? "",
    request.headers.get("sec-ch-ua")?.trim() ?? "",
    request.headers.get("sec-ch-ua-platform")?.trim() ?? "",
  ].join("|")

  if (!source.replace(/\|/g, "")) {
    return CLIENT_ID_FALLBACK
  }

  const encoded = new TextEncoder().encode(source)
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded)
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return hashHex.slice(0, 16)
}
```

**Step 5: Make getIpIdentifier async**

Replace `getIpIdentifier`:

```ts
async function getIpIdentifier(request: Request): Promise<string> {
  const ip = getClientIp(request)
  if (ip) {
    return ip
  }

  return `fp:${await getFallbackFingerprint(request)}`
}
```

**Step 6: Await getIpIdentifier in evaluateRpcRateLimit**

In `evaluateRpcRateLimit`, find the `getRateLimitKey` call for IP and change:
```ts
        identifier: getIpIdentifier(request),
```
to:
```ts
        identifier: await getIpIdentifier(request),
```

**Step 7: Install and type check**

```bash
cd /var/www/forks/crikket && bun install && bun run check-types --filter @crikket/api
```

Expected: no errors.

**Step 8: Commit**

```bash
git add packages/api/
git commit -m "feat: replace node:net and node:crypto in rate-limit with Web APIs"
```

---

### Task 3: Replace node:zlib in ingestion-jobs.ts

**Files:**
- Modify: `packages/bug-reports/src/lib/ingestion-jobs.ts`

**Step 1: Remove node:zlib import**

Remove this line from the top of `ingestion-jobs.ts`:
```ts
import { gunzipSync } from "node:zlib"
```

**Step 2: Add decompressGzip helper**

Add this function immediately before the `ingestDebuggerPayload` private function:

```ts
async function decompressGzip(input: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip")
  const writer = ds.writable.getWriter()
  const reader = ds.readable.getReader()

  writer.write(input)
  await writer.close()

  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
```

**Step 3: Update ingestDebuggerPayload**

In `ingestDebuggerPayload`, replace:
```ts
  const storedPayload = await storage.read(input.debuggerKey)
  const payloadBuffer =
    input.debuggerContentEncoding === "gzip"
      ? gunzipSync(storedPayload)
      : storedPayload
  const rawPayload = JSON.parse(payloadBuffer.toString("utf8")) as {
```
with:
```ts
  const storedPayload = await storage.read(input.debuggerKey)
  const payloadBuffer =
    input.debuggerContentEncoding === "gzip"
      ? await decompressGzip(storedPayload)
      : storedPayload
  const rawPayload = JSON.parse(new TextDecoder().decode(payloadBuffer)) as {
```

Note: `storage.read()` returns `Promise<Buffer>`. `Buffer` is a subclass of `Uint8Array` in Node.js/Bun, so passing it to `decompressGzip(input: Uint8Array)` is valid.

**Step 4: Type check**

```bash
bun run check-types --filter @crikket/bug-reports
```

Expected: no errors.

**Step 5: Commit**

```bash
git add packages/bug-reports/src/lib/ingestion-jobs.ts
git commit -m "feat: replace node:zlib gunzipSync with DecompressionStream"
```

---

### Task 4: Replace node:crypto in polar-payload.ts

**Files:**
- Modify: `packages/billing/src/service/polar-payload.ts`
- Modify: `packages/billing/src/service/webhooks/process-polar-webhook-payload.ts`

**Step 1: Remove node:crypto import**

In `packages/billing/src/service/polar-payload.ts`, remove:
```ts
import { createHash } from "node:crypto"
```

**Step 2: Make extractProviderEventId async**

Change the function signature from:
```ts
export function extractProviderEventId(
  payload: PolarWebhookPayload,
  eventType: string
): string {
```
to:
```ts
export async function extractProviderEventId(
  payload: PolarWebhookPayload,
  eventType: string
): Promise<string> {
```

Then replace the `createHash` block inside the function. Find:
```ts
  const serializedPayload = serializeStablePayloadForHash(payload)
  const payloadFingerprint = createHash("sha256")
    .update(eventType)
    .update(":")
    .update(secondaryId)
    .update(":")
    .update(serializedPayload)
    .digest("hex")
    .slice(0, 32)
```
Replace with:
```ts
  const serializedPayload = serializeStablePayloadForHash(payload)
  const encoded = new TextEncoder().encode(
    `${eventType}:${secondaryId}:${serializedPayload}`
  )
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded)
  const payloadFingerprint = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32)
```

**Step 3: Await in process-polar-webhook-payload.ts**

In `packages/billing/src/service/webhooks/process-polar-webhook-payload.ts`, line 164, change:
```ts
  const providerEventId = extractProviderEventId(payload, eventType)
```
to:
```ts
  const providerEventId = await extractProviderEventId(payload, eventType)
```

The surrounding `processPolarWebhookPayload` function is already `async`, so no further changes needed.

**Step 4: Type check**

```bash
bun run check-types --filter @crikket/billing
```

Expected: no errors.

**Step 5: Commit**

```bash
git add packages/billing/
git commit -m "feat: replace node:crypto in polar-payload with crypto.subtle"
```

---

### Task 5: Add createServerEnv factory and BACKGROUND_JOBS to packages/env

**Files:**
- Modify: `packages/env/src/server.ts`

**Step 1: Rewrite server.ts to extract schema and add factory**

Replace the entire file with:

```ts
import "dotenv/config"
import { createEnv } from "@t3-oss/env-core"
import { z } from "zod"

const serverSchema = {
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
  ALLOWED_SIGNUP_DOMAINS: z
    .string()
    .optional()
    .transform(
      (value) =>
        value
          ?.split(",")
          .map((d) => d.trim())
          .filter((d) => d.length > 0) ?? []
    ),
  BACKGROUND_JOBS: z.enum(["native", "disabled"]).default("native"),
  POLAR_ACCESS_TOKEN: z.string().min(1).optional(),
  POLAR_SUCCESS_URL: z.url().optional(),
  POLAR_WEBHOOK_SECRET: z.string().min(1).optional(),
  POLAR_PRO_PRODUCT_ID: z.string().min(1).optional(),
  POLAR_PRO_YEARLY_PRODUCT_ID: z.string().min(1).optional(),
  POLAR_STUDIO_PRODUCT_ID: z.string().min(1).optional(),
  POLAR_STUDIO_YEARLY_PRODUCT_ID: z.string().min(1).optional(),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform(
      (value) =>
        value
          ?.split(",")
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0) ?? []
    ),
  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM_EMAIL: z.email().optional(),
  ENABLE_PAYMENTS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  STORAGE_BUCKET: z.string().min(1).optional(),
  STORAGE_REGION: z.string().min(1).optional(),
  STORAGE_ENDPOINT: z.url().optional(),
  STORAGE_ADDRESSING_STYLE: z.enum(["auto", "path", "virtual"]).optional(),
  STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  STORAGE_PUBLIC_URL: z.url().optional(),
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  CAPTURE_SUBMIT_TOKEN_SECRET: z.string().min(32).optional(),
  TURNSTILE_SITE_KEY: z.string().min(1).optional(),
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  NODE_ENV: z
    .enum(["development", "production", "staging"])
    .default("development"),
} as const

// For Cloudflare Workers: call createServerEnv(workerEnvBindings) instead of
// using the env singleton, since Workers does not populate process.env from bindings.
export function createServerEnv(runtimeEnv: Record<string, string | undefined>) {
  return createEnv({
    server: serverSchema,
    runtimeEnv,
    emptyStringAsUndefined: true,
  })
}

export type ServerEnv = ReturnType<typeof createServerEnv>

// Traditional targets (Bun, Node.js, Lambda, Cloud Run): use this singleton.
export const env = createServerEnv(
  process.env as Record<string, string | undefined>
)
```

**Step 2: Type check**

```bash
bun run check-types --filter @crikket/env
```

Expected: no errors.

**Step 3: Commit**

```bash
git add packages/env/src/server.ts
git commit -m "feat: add createServerEnv factory and BACKGROUND_JOBS env var"
```

---

### Task 6: Gate setInterval behind BACKGROUND_JOBS in apps/server

**Files:**
- Modify: `apps/server/src/index.ts`

**Step 1: Wrap the three setInterval blocks**

In `apps/server/src/index.ts`, the three `setInterval` blocks are at lines ~147–175. Wrap all three inside a single guard:

Replace:
```ts
const cleanupInterval = setInterval(() => {
  runArtifactCleanupPass({ limit: 50 }).catch((error: unknown) => {
    console.error("[artifact-cleanup] failed scheduled cleanup pass", error)
  })
}, STORAGE_CLEANUP_INTERVAL_MS)

cleanupInterval.unref?.()

const ingestionInterval = setInterval(() => {
  runBugReportIngestionPass({ limit: 10 }).catch((error: unknown) => {
    console.error(
      "[bug-report-ingestion] failed scheduled ingestion pass",
      error
    )
  })
}, BUG_REPORT_INGESTION_INTERVAL_MS)

ingestionInterval.unref?.()

const orphanCleanupInterval = setInterval(() => {
  runStalePendingBugReportCleanupPass({ limit: 10 }).catch((error: unknown) => {
    console.error(
      "[bug-report-orphan-cleanup] failed scheduled orphan cleanup pass",
      error
    )
  })
}, BUG_REPORT_ORPHAN_CLEANUP_INTERVAL_MS)

orphanCleanupInterval.unref?.()
```

with:

```ts
if (env.BACKGROUND_JOBS === "native") {
  const cleanupInterval = setInterval(() => {
    runArtifactCleanupPass({ limit: 50 }).catch((error: unknown) => {
      console.error("[artifact-cleanup] failed scheduled cleanup pass", error)
    })
  }, STORAGE_CLEANUP_INTERVAL_MS)

  cleanupInterval.unref?.()

  const ingestionInterval = setInterval(() => {
    runBugReportIngestionPass({ limit: 10 }).catch((error: unknown) => {
      console.error(
        "[bug-report-ingestion] failed scheduled ingestion pass",
        error
      )
    })
  }, BUG_REPORT_INGESTION_INTERVAL_MS)

  ingestionInterval.unref?.()

  const orphanCleanupInterval = setInterval(() => {
    runStalePendingBugReportCleanupPass({ limit: 10 }).catch((error: unknown) => {
      console.error(
        "[bug-report-orphan-cleanup] failed scheduled orphan cleanup pass",
        error
      )
    })
  }, BUG_REPORT_ORPHAN_CLEANUP_INTERVAL_MS)

  orphanCleanupInterval.unref?.()
}
```

**Step 2: Type check**

```bash
bun run check-types --filter server
```

Expected: no errors.

**Step 3: Commit**

```bash
git add apps/server/src/index.ts
git commit -m "feat: gate native background jobs behind BACKGROUND_JOBS=native"
```

---

### Task 7: Create packages/jobs

**Files:**
- Create: `packages/jobs/package.json`
- Create: `packages/jobs/src/index.ts`
- Create: `packages/jobs/tsconfig.json`

**Step 1: Create packages/jobs/package.json**

```json
{
  "name": "@crikket/jobs",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "check-types": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@crikket/bug-reports": "workspace:*"
  },
  "devDependencies": {
    "@crikket/config": "workspace:*",
    "typescript": "catalog:"
  }
}
```

**Step 2: Create packages/jobs/src/index.ts**

```ts
export { runArtifactCleanupPass } from "@crikket/bug-reports/lib/storage"
export { runBugReportIngestionPass } from "@crikket/bug-reports/lib/ingestion-jobs"
export { runStalePendingBugReportCleanupPass } from "@crikket/bug-reports/lib/orphan-cleanup"
```

**Step 3: Create packages/jobs/tsconfig.json**

```json
{
  "extends": "@crikket/config/tsconfig.base.json",
  "compilerOptions": {
    "strictNullChecks": true
  },
  "include": ["src"]
}
```

**Step 4: Install and type check**

```bash
cd /var/www/forks/crikket && bun install && bun run check-types --filter @crikket/jobs
```

Expected: no errors. Bun workspaces auto-discovers `packages/jobs` via the `"packages/*"` glob in the root package.json.

**Step 5: Commit**

```bash
git add packages/jobs/
git commit -m "feat: add @crikket/jobs package exposing scheduled job functions"
```

---

### Task 8: Create apps/worker (Cloudflare Workers cron handler)

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/wrangler.toml`
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/tsconfig.json`

**Step 1: Create apps/worker/package.json**

```json
{
  "name": "worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "check-types": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@crikket/db": "workspace:*",
    "@crikket/jobs": "workspace:*"
  },
  "devDependencies": {
    "@crikket/config": "workspace:*",
    "@cloudflare/workers-types": "^4.20250422.0",
    "typescript": "catalog:",
    "wrangler": "^4.0.0"
  }
}
```

**Step 2: Create apps/worker/wrangler.toml**

```toml
name = "crikket-worker"
main = "src/index.ts"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]

[[hyperdrive]]
binding = "DB"
id = ""  # Set to your Hyperdrive config ID from the Cloudflare dashboard

[triggers]
crons = ["*/5 * * * *", "* * * * *", "0 * * * *"]

# Development defaults — set secrets via `wrangler secret put <KEY>` for production
[vars]
NODE_ENV = "production"
# Add STORAGE_BUCKET, STORAGE_REGION, STORAGE_ACCESS_KEY_ID, etc.
```

**Step 3: Create apps/worker/src/index.ts**

```ts
import { initDb } from "@crikket/db"
import {
  runArtifactCleanupPass,
  runBugReportIngestionPass,
  runStalePendingBugReportCleanupPass,
} from "@crikket/jobs"

interface Env {
  DB: { connectionString: string }
  [key: string]: unknown
}

export default {
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    initDb(env.DB.connectionString)

    switch (event.cron) {
      case "*/5 * * * *":
        await runArtifactCleanupPass({ limit: 50 })
        break
      case "* * * * *":
        await runBugReportIngestionPass({ limit: 10 })
        break
      case "0 * * * *":
        await runStalePendingBugReportCleanupPass({ limit: 10 })
        break
      default:
        console.error(`[worker] unknown cron: ${event.cron}`)
    }
  },
} satisfies ExportedHandler<Env>
```

**Step 4: Create apps/worker/tsconfig.json**

```json
{
  "extends": "@crikket/config/tsconfig.base.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src"]
}
```

**Step 5: Install and type check**

```bash
cd /var/www/forks/crikket && bun install && bun run check-types --filter worker
```

Expected: no errors. If `@cloudflare/workers-types` is not found in the catalog, add it directly with the version above.

**Step 6: Commit**

```bash
git add apps/worker/
git commit -m "feat: add Cloudflare Worker cron handler for background jobs"
```

---

### Task 9: Create apps/jobs-lambda (AWS Lambda handler)

**Files:**
- Create: `apps/jobs-lambda/package.json`
- Create: `apps/jobs-lambda/src/index.ts`
- Create: `apps/jobs-lambda/tsconfig.json`

**Step 1: Create apps/jobs-lambda/package.json**

```json
{
  "name": "jobs-lambda",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsdown",
    "check-types": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@crikket/jobs": "workspace:*"
  },
  "devDependencies": {
    "@crikket/config": "workspace:*",
    "@types/aws-lambda": "^8.10.149",
    "tsdown": "^0.16.5",
    "typescript": "catalog:"
  }
}
```

**Step 2: Create apps/jobs-lambda/src/index.ts**

EventBridge scheduled rules pass `{ "job": "<name>" }` in the event detail. Create three separate rules, one per job, each pointing at this same Lambda function.

```ts
import {
  runArtifactCleanupPass,
  runBugReportIngestionPass,
  runStalePendingBugReportCleanupPass,
} from "@crikket/jobs"
import type { EventBridgeEvent } from "aws-lambda"

type JobName = "artifact-cleanup" | "ingestion" | "orphan-cleanup"

export async function handler(
  event: EventBridgeEvent<"Scheduled Event", { job: JobName }>
): Promise<void> {
  const job = event.detail?.job

  switch (job) {
    case "artifact-cleanup":
      await runArtifactCleanupPass({ limit: 50 })
      break
    case "ingestion":
      await runBugReportIngestionPass({ limit: 10 })
      break
    case "orphan-cleanup":
      await runStalePendingBugReportCleanupPass({ limit: 10 })
      break
    default:
      throw new Error(`Unknown job: ${String(job)}`)
  }
}
```

**Step 3: Create apps/jobs-lambda/tsconfig.json**

```json
{
  "extends": "@crikket/config/tsconfig.base.json",
  "compilerOptions": {
    "strictNullChecks": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 4: Install and type check**

```bash
cd /var/www/forks/crikket && bun install && bun run check-types --filter jobs-lambda
```

Expected: no errors.

**Step 5: Commit**

```bash
git add apps/jobs-lambda/
git commit -m "feat: add AWS Lambda handler for background jobs via EventBridge"
```

---

### Task 10: Create apps/jobs-cloudrun (Cloud Run Job)

**Files:**
- Create: `apps/jobs-cloudrun/package.json`
- Create: `apps/jobs-cloudrun/src/index.ts`
- Create: `apps/jobs-cloudrun/tsconfig.json`
- Create: `apps/jobs-cloudrun/Dockerfile`

**Step 1: Create apps/jobs-cloudrun/package.json**

```json
{
  "name": "jobs-cloudrun",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/index.ts",
    "check-types": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@crikket/jobs": "workspace:*"
  },
  "devDependencies": {
    "@crikket/config": "workspace:*",
    "@types/bun": "catalog:",
    "typescript": "catalog:"
  }
}
```

**Step 2: Create apps/jobs-cloudrun/src/index.ts**

Cloud Scheduler creates three separate Cloud Run Jobs, all using the same container image. It differentiates them via the `JOB` environment variable override per job config.

```ts
import {
  runArtifactCleanupPass,
  runBugReportIngestionPass,
  runStalePendingBugReportCleanupPass,
} from "@crikket/jobs"

const job = process.env.JOB

async function main(): Promise<void> {
  switch (job) {
    case "artifact-cleanup":
      await runArtifactCleanupPass({ limit: 50 })
      break
    case "ingestion":
      await runBugReportIngestionPass({ limit: 10 })
      break
    case "orphan-cleanup":
      await runStalePendingBugReportCleanupPass({ limit: 10 })
      break
    default:
      throw new Error(`Unknown JOB env var: ${String(job)}`)
  }

  console.log(`[jobs-cloudrun] ${job} completed`)
}

main().catch((error) => {
  console.error("[jobs-cloudrun] job failed", error)
  process.exit(1)
})
```

**Step 3: Create apps/jobs-cloudrun/tsconfig.json**

```json
{
  "extends": "@crikket/config/tsconfig.base.json",
  "compilerOptions": {
    "strictNullChecks": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 4: Create apps/jobs-cloudrun/Dockerfile**

Cloud Run Jobs expect the container to run to completion and exit 0 on success.

```dockerfile
FROM oven/bun:1.3.5-alpine AS base
WORKDIR /app

FROM base AS install
COPY bun.lock* package.json ./
COPY apps/jobs-cloudrun/package.json ./apps/jobs-cloudrun/
COPY packages/ ./packages/
RUN bun install --frozen-lockfile

FROM base AS runner
COPY --from=install /app .
CMD ["bun", "run", "apps/jobs-cloudrun/src/index.ts"]
```

**Step 5: Install and type check**

```bash
cd /var/www/forks/crikket && bun install && bun run check-types --filter jobs-cloudrun
```

Expected: no errors.

**Step 6: Commit**

```bash
git add apps/jobs-cloudrun/
git commit -m "feat: add Cloud Run Job container for background jobs via Cloud Scheduler"
```

---

### Task 11: Add deployment configs

**Files:**
- Create: `apps/server/wrangler.toml`

**Step 1: Create apps/server/wrangler.toml**

```toml
name = "crikket-server"
main = "src/index.ts"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]

[[hyperdrive]]
binding = "DB"
id = ""  # Set to your Hyperdrive config ID from the Cloudflare dashboard

# Background jobs are handled by apps/worker when deploying to Workers
[vars]
BACKGROUND_JOBS = "disabled"
NODE_ENV = "production"
# All other env vars must be set as secrets:
#   wrangler secret put BETTER_AUTH_SECRET
#   wrangler secret put DATABASE_URL  (only needed if not using Hyperdrive for all access)
#   wrangler secret put STORAGE_SECRET_ACCESS_KEY
#   etc.
```

**Note:** `apps/server/src/index.ts` currently reads `env.CORS_ORIGINS` and `env.BETTER_AUTH_URL` at module load time (lines 25–27). These use the `env` singleton which reads from `process.env`. For Workers, `process.env` is not automatically populated from Worker bindings. Full Workers deployment of the API server requires a follow-up task to make those references lazy (per-request via Hono context). The `wrangler.toml` is the deployment config foundation.

**Step 2: Commit**

```bash
git add apps/server/wrangler.toml
git commit -m "chore: add wrangler.toml for Cloudflare Workers server deployment"
```

---

### Task 12: Final verification

**Step 1: Full workspace type check**

```bash
cd /var/www/forks/crikket && bun run check-types
```

Expected: zero errors across all packages and apps. Fix any errors before proceeding.

**Step 2: Lint check**

```bash
bun run check
```

Expected: no lint errors. If there are auto-fixable issues:

```bash
bun run fix
git add -A
git commit -m "chore: fix lint issues after hosting flexibility changes"
```

**Step 3: Smoke test dev server**

```bash
bun run dev:server &
sleep 3
curl -s http://localhost:3000/
kill %1
```

Expected: `OK` response, no startup errors in the server log.
