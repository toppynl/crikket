# Cloudflare Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename master→main, merge all open PRs, implement hosting flexibility code changes, and deploy the full stack (server + web + worker) to Cloudflare via a local gitignored `deploy/` directory.

**Architecture:** A gitignored `deploy/` directory at the monorepo root holds all wrangler configs and a `deploy.sh` script. The server runs as a Cloudflare Worker (Hono, `apps/server/src/worker.ts` entry point), the web app runs on Cloudflare Pages (`@cloudflare/next-on-pages`), and background jobs run in a separate Cloudflare Worker with cron triggers (`apps/worker`). Database is Neon PostgreSQL accessed via Cloudflare Hyperdrive. Storage is Cloudflare R2 accessed via the existing S3-compatible API (env vars, no bindings needed).

**Tech Stack:** postgres.js, drizzle-orm/postgres-js, is-ip, Web Crypto API (crypto.subtle), Web Streams API (DecompressionStream), @cloudflare/next-on-pages, wrangler CLI, Cloudflare Workers, Cloudflare Pages, Cloudflare Hyperdrive, Cloudflare R2

---

### Task 1: Rename master → main

**Files:** none (git operations only)

**Step 1: Switch to master and rename locally**

```bash
git checkout master
git branch -m master main
```

**Step 2: Push the new branch name and delete the old remote**

```bash
git push origin main
git push origin --delete master
```

**Step 3: Update GitHub default branch**

```bash
gh repo edit --default-branch main
```

Expected: `✓ Edited repository`

**Step 4: Update local tracking**

```bash
git branch --set-upstream-to=origin/main main
```

---

### Task 2: Merge PR #1 (GitHub integration)

**Files:** none (git operation)

**Step 1: Merge**

```bash
gh pr merge 1 --merge --delete-branch
```

Expected: `✓ Merged pull request #1`

**Step 2: Pull the merged changes**

```bash
git pull origin main
```

---

### Task 3: Merge PR #2 (Project entity)

PR #2 modifies files already changed by PR #1 — merge after #1.

**Step 1: Merge**

```bash
gh pr merge 2 --merge --delete-branch
```

Expected: `✓ Merged pull request #2`

**Step 2: Pull**

```bash
git pull origin main
```

---

### Task 4: Merge PR #3 (Hosting flexibility docs)

PR #3 only contains design and plan docs — no code conflicts expected.

**Step 1: Merge**

```bash
gh pr merge 3 --merge --delete-branch
```

**Step 2: Pull**

```bash
git pull origin main
```

---

### Task 5: Swap database driver to postgres.js

**Files:**
- Modify: `packages/db/package.json`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/api/package.json` (remove stale @types/pg)

**Step 1: Update packages/db/package.json**

Remove `pg` from dependencies. Remove `@types/pg` from devDependencies. Add `postgres`:

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

**Step 2: Rewrite packages/db/src/index.ts**

```ts
import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"

import * as schema from "./schema"

export type Database = ReturnType<typeof drizzle<typeof schema>>

// prepare: false is required for Cloudflare Hyperdrive
export function createDb(connectionString: string): Database {
  return drizzle(postgres(connectionString, { prepare: false }), { schema })
}

let _db: Database | undefined

export function initDb(connectionString: string): void {
  _db = createDb(connectionString)
}

// Proxy keeps `import { db } from "@crikket/db"` working everywhere unchanged.
// Throws at access time if initDb was never called.
export const db = new Proxy({} as Database, {
  get(_target, prop) {
    if (!_db) {
      throw new Error("DB not initialized. Call initDb() before any db access.")
    }
    return (_db as unknown as Record<string | symbol, unknown>)[prop]
  },
})
```

**Step 3: Remove @types/pg from packages/api/package.json if present**

Check `packages/api/package.json` for `"@types/pg"` and remove it if found.

**Step 4: Initialize db in apps/server/src/index.ts**

Add `initDb` call at the top of `apps/server/src/index.ts`, before the Hono app setup. Import from `@crikket/db` and `@crikket/env/server`:

```ts
import { initDb } from "@crikket/db"
import { env } from "@crikket/env/server"

initDb(env.DATABASE_URL)
```

Place these lines immediately after the existing imports, before `const app = new Hono()`.

**Step 5: Install and verify**

```bash
bun install
bun run check-types
```

Expected: no type errors. If `drizzle-orm/node-postgres` errors appear, they mean an old import was missed — grep and fix:

```bash
grep -r "node-postgres" packages/ apps/
```

**Step 6: Commit**

```bash
git add packages/db packages/api/package.json apps/server/src/index.ts bun.lock
git commit -m "feat(db): swap driver to postgres.js with createDb/initDb factory"
```

---

### Task 6: Web API refactor — rate-limit.ts

Replace `node:crypto` (`createHash`) and `node:net` (`isIP`) with portable Web APIs.

**Files:**
- Modify: `packages/api/src/rate-limit.ts`
- Modify: `packages/api/package.json`

**Step 1: Add is-ip to packages/api/package.json**

```bash
cd packages/api && bun add is-ip
```

**Step 2: Update packages/api/src/rate-limit.ts**

Remove:
```ts
import { createHash } from "node:crypto"
import { isIP } from "node:net"
```

Add:
```ts
import { isIP } from "is-ip"
```

Replace the `getFallbackFingerprint` function (sync → async):

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

  const data = new TextEncoder().encode(source)
  const buffer = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16)
}
```

Update `getIpIdentifier` to async (it calls `getFallbackFingerprint`):

```ts
async function getIpIdentifier(request: Request): Promise<string> {
  const ip = getClientIp(request)
  if (ip) {
    return ip
  }
  return `fp:${await getFallbackFingerprint(request)}`
}
```

Update the call site in `evaluateRpcRateLimit`:

```ts
identifier: await getIpIdentifier(request),
```

Note: `is-ip`'s `isIP` returns `boolean` (truthy/falsy), matching the existing usage pattern `isIP(candidate) ? candidate : null`.

**Step 3: Type-check**

```bash
bun run check-types
```

**Step 4: Commit**

```bash
git add packages/api/src/rate-limit.ts packages/api/package.json bun.lock
git commit -m "refactor(api): replace node:crypto and node:net with Web APIs in rate-limit"
```

---

### Task 7: Web API refactor — ingestion-jobs.ts

Replace `node:zlib` (`gunzipSync`) with `DecompressionStream`.

**Files:**
- Modify: `packages/bug-reports/src/lib/ingestion-jobs.ts`

**Step 1: Add gunzip helper**

In `ingestion-jobs.ts`, remove:
```ts
import { gunzipSync } from "node:zlib"
```

Add this helper function near the top of the file:

```ts
async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
```

**Step 2: Replace gunzipSync calls**

Find every `gunzipSync(...)` call and replace with `await gunzip(...)`. The containing function is already async, so no signature change is needed.

```bash
grep -n "gunzipSync" packages/bug-reports/src/lib/ingestion-jobs.ts
```

**Step 3: Type-check**

```bash
bun run check-types
```

**Step 4: Commit**

```bash
git add packages/bug-reports/src/lib/ingestion-jobs.ts
git commit -m "refactor(bug-reports): replace node:zlib gunzipSync with DecompressionStream"
```

---

### Task 8: Web API refactor — polar-payload.ts

Replace `node:crypto` (`createHash`) in `packages/billing/src/service/polar-payload.ts`.

**Files:**
- Modify: `packages/billing/src/service/polar-payload.ts`

**Step 1: Remove node:crypto import**

Remove:
```ts
import { createHash } from "node:crypto"
```

**Step 2: Make extractProviderEventId async and replace createHash**

The function `extractProviderEventId` (line 280) is currently sync. Change its signature to async and replace the hash block:

Before:
```ts
export function extractProviderEventId(
  payload: PolarWebhookPayload,
  eventType: string
): string {
```

After:
```ts
export async function extractProviderEventId(
  payload: PolarWebhookPayload,
  eventType: string
): Promise<string> {
```

Replace the `createHash` block (lines ~301-308):
```ts
  const data = new TextEncoder().encode(
    `${eventType}:${secondaryId}:${serializedPayload}`
  )
  const buffer = await crypto.subtle.digest("SHA-256", data)
  const payloadFingerprint = Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32)
```

**Step 3: Fix callers of extractProviderEventId**

```bash
grep -rn "extractProviderEventId" packages/billing/src/
```

Add `await` to every call site, and ensure the containing function is async.

**Step 4: Type-check and commit**

```bash
bun run check-types
git add packages/billing/
git commit -m "refactor(billing): replace node:crypto with crypto.subtle in polar-payload"
```

---

### Task 9: Env — remove dotenv from packages/env, make DATABASE_URL optional

`packages/env/src/server.ts` currently imports `"dotenv/config"` at the module level. This works for Bun but is unreliable in Cloudflare Workers (Workers don't have a filesystem). We move the dotenv import to the Bun server entry point instead and make `DATABASE_URL` optional so the Workers entry can skip it (Hyperdrive provides the connection string at runtime).

**Files:**
- Modify: `packages/env/src/server.ts`
- Modify: `apps/server/src/index.ts`

**Step 1: Update packages/env/src/server.ts**

Remove the first line:
```ts
import "dotenv/config"
```

Change `DATABASE_URL` to optional:
```ts
DATABASE_URL: z.string().min(1).optional(),
```

**Step 2: Add dotenv import to apps/server/src/index.ts**

At the very top of `apps/server/src/index.ts`, before all other imports:
```ts
import "dotenv/config"
```

**Step 3: Guard initDb call**

The `initDb(env.DATABASE_URL)` added in Task 5 now receives `string | undefined`. Update it:

```ts
if (env.DATABASE_URL) {
  initDb(env.DATABASE_URL)
}
```

**Step 4: Type-check**

```bash
bun run check-types
```

**Step 5: Commit**

```bash
git add packages/env/src/server.ts apps/server/src/index.ts
git commit -m "refactor(env): move dotenv import to server entry, make DATABASE_URL optional"
```

---

### Task 10: Gate background jobs behind BACKGROUND_JOBS env var

**Files:**
- Modify: `packages/env/src/server.ts`
- Modify: `apps/server/src/index.ts`

**Step 1: Add BACKGROUND_JOBS to env schema**

In `packages/env/src/server.ts`, add to the server schema:
```ts
BACKGROUND_JOBS: z.enum(["native", "disabled"]).default("native"),
```

**Step 2: Gate setIntervals in apps/server/src/index.ts**

Wrap all three `setInterval` blocks:

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
      console.error("[bug-report-ingestion] failed scheduled ingestion pass", error)
    })
  }, BUG_REPORT_INGESTION_INTERVAL_MS)
  ingestionInterval.unref?.()

  const orphanCleanupInterval = setInterval(() => {
    runStalePendingBugReportCleanupPass({ limit: 10 }).catch((error: unknown) => {
      console.error("[bug-report-orphan-cleanup] failed scheduled orphan cleanup pass", error)
    })
  }, BUG_REPORT_ORPHAN_CLEANUP_INTERVAL_MS)
  orphanCleanupInterval.unref?.()
}
```

**Step 3: Type-check and commit**

```bash
bun run check-types
git add packages/env/src/server.ts apps/server/src/index.ts
git commit -m "feat(server): gate background jobs behind BACKGROUND_JOBS env var"
```

---

### Task 11: Create packages/jobs

New package that re-exports the three job functions as a clean public API.

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
    ".": { "default": "./src/index.ts" }
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
  "extends": "@crikket/config/tsconfig/base.json",
  "include": ["src"],
  "compilerOptions": {
    "outDir": "dist"
  }
}
```

**Step 4: Register in root package.json workspaces**

Check `package.json` at the root. If it lists workspaces explicitly, add `"packages/jobs"`. If it uses a glob like `"packages/*"`, no change needed.

**Step 5: Install and type-check**

```bash
bun install
bun run check-types
```

**Step 6: Commit**

```bash
git add packages/jobs
git commit -m "feat(jobs): add packages/jobs with re-exported job functions"
```

---

### Task 12: Create apps/worker (Cloudflare Worker with cron triggers)

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/tsconfig.json`

**Step 1: Create apps/worker/package.json**

```json
{
  "name": "worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "check-types": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@crikket/db": "workspace:*",
    "@crikket/env": "workspace:*",
    "@crikket/jobs": "workspace:*"
  },
  "devDependencies": {
    "@crikket/config": "workspace:*",
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "catalog:"
  }
}
```

**Step 2: Create apps/worker/src/index.ts**

```ts
import { initDb } from "@crikket/db"
import {
  runArtifactCleanupPass,
  runBugReportIngestionPass,
  runStalePendingBugReportCleanupPass,
} from "@crikket/jobs"

interface Env {
  DB: Hyperdrive
}

export default {
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    initDb(env.DB.connectionString)

    const cron = event.cron

    if (cron === "* * * * *") {
      ctx.waitUntil(
        runBugReportIngestionPass({ limit: 10 }).catch((error: unknown) => {
          console.error("[worker] ingestion pass failed", error)
        })
      )
    } else if (cron === "*/5 * * * *") {
      ctx.waitUntil(
        runArtifactCleanupPass({ limit: 50 }).catch((error: unknown) => {
          console.error("[worker] artifact cleanup failed", error)
        })
      )
    } else if (cron === "0 * * * *") {
      ctx.waitUntil(
        runStalePendingBugReportCleanupPass({ limit: 10 }).catch(
          (error: unknown) => {
            console.error("[worker] orphan cleanup failed", error)
          }
        )
      )
    }
  },
}
```

**Step 3: Create apps/worker/tsconfig.json**

```json
{
  "extends": "@crikket/config/tsconfig/base.json",
  "include": ["src"],
  "compilerOptions": {
    "outDir": "dist",
    "types": ["@cloudflare/workers-types"]
  }
}
```

**Step 4: Install and type-check**

```bash
bun install
bun run check-types
```

**Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): add Cloudflare Worker with scheduled cron job handlers"
```

---

### Task 13: Create apps/server/src/worker.ts (Cloudflare Workers entry point)

The existing `src/index.ts` is the Bun server entry. Workers need a separate entry that initializes the DB from the Hyperdrive binding.

**Files:**
- Create: `apps/server/src/worker.ts`

**Step 1: Create apps/server/src/worker.ts**

```ts
import { initDb } from "@crikket/db"
import app from "./index"

interface Env {
  DB: Hyperdrive
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    initDb(env.DB.connectionString)
    return app.fetch(request, env, ctx)
  },
}
```

**Step 2: Type-check**

Add `@cloudflare/workers-types` to `apps/server` devDependencies if not already present:

```bash
cd apps/server && bun add -d @cloudflare/workers-types
```

Update `apps/server/tsconfig.json` to include the workers types, or rely on the wrangler config to provide them.

```bash
bun run check-types
```

**Step 3: Commit**

```bash
git add apps/server/src/worker.ts apps/server/package.json apps/server/tsconfig.json bun.lock
git commit -m "feat(server): add Cloudflare Workers entry point (worker.ts)"
```

---

### Task 14: Add @cloudflare/next-on-pages to apps/web

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/next.config.ts` (or `.mjs`)

**Step 1: Install the adapter**

```bash
cd apps/web && bun add -d @cloudflare/next-on-pages
```

**Step 2: Add build script to apps/web/package.json**

In the `scripts` section, add:
```json
"build:cf": "next build && npx @cloudflare/next-on-pages"
```

**Step 3: Verify next.config**

Check `apps/web/next.config.ts`. The `@cloudflare/next-on-pages` adapter works with the App Router. No config changes are typically required. If there are any `serverExternalPackages` or custom webpack configs, verify they don't use node-only APIs.

**Step 4: Test build**

```bash
cd apps/web && bun run build:cf
```

Expected: creates `.vercel/output/static/` (Pages deployment artifact).

If errors appear about unsupported Node.js APIs in page/route components, fix them by adding `export const runtime = "edge"` to the affected routes or replacing the APIs.

**Step 5: Commit**

```bash
git add apps/web/package.json apps/web/next.config.ts bun.lock
git commit -m "feat(web): add @cloudflare/next-on-pages build script"
```

---

### Task 15: Create deploy/ directory with wrangler configs

**Files:**
- Modify: `.gitignore`
- Create: `deploy/server/wrangler.toml`
- Create: `deploy/worker/wrangler.toml`
- Create: `deploy/web/wrangler.toml`
- Create: `deploy/.env.example`
- Create: `deploy/deploy.sh`

**Step 1: Add deploy/ to .gitignore**

Append to `.gitignore`:
```
# Local deployment configs (not committed)
/deploy/
```

**Step 2: Create deploy/server/wrangler.toml**

Replace `<HYPERDRIVE_ID>` with your actual Hyperdrive config ID (obtained in Task 16).
Replace `<ACCOUNT_ID>` with your Cloudflare account ID.

```toml
name = "crikket-server"
main = "../../apps/server/src/worker.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[build]
command = "bun run build"

[[hyperdrive]]
binding = "DB"
id = "<HYPERDRIVE_ID>"

[vars]
BACKGROUND_JOBS = "disabled"
NODE_ENV = "production"
# Add all other server env vars here as [vars] or use wrangler secret put for secrets:
# BETTER_AUTH_URL = "https://your-server.workers.dev"
# BETTER_AUTH_COOKIE_DOMAIN = "yourdomain.com"
# CORS_ORIGINS = "https://your-web.pages.dev"
# STORAGE_BUCKET = "crikket-captures"
# STORAGE_REGION = "auto"
# STORAGE_ENDPOINT = "https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
# STORAGE_ADDRESSING_STYLE = "path"
```

Secrets (values containing API keys, secrets) should be set with:
```bash
wrangler secret put BETTER_AUTH_SECRET --config deploy/server/wrangler.toml
wrangler secret put STORAGE_ACCESS_KEY_ID --config deploy/server/wrangler.toml
wrangler secret put STORAGE_SECRET_ACCESS_KEY --config deploy/server/wrangler.toml
```

**Step 3: Create deploy/worker/wrangler.toml**

```toml
name = "crikket-worker"
main = "../../apps/worker/src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[hyperdrive]]
binding = "DB"
id = "<HYPERDRIVE_ID>"

[triggers]
crons = [
  "* * * * *",
  "*/5 * * * *",
  "0 * * * *"
]
```

**Step 4: Create deploy/web/wrangler.toml**

```toml
name = "crikket-web"
pages_build_output_dir = "../../apps/web/.vercel/output/static"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[vars]
NEXT_PUBLIC_SERVER_URL = "https://crikket-server.<YOUR_SUBDOMAIN>.workers.dev"
# Add other NEXT_PUBLIC_* vars
```

**Step 5: Create deploy/.env.example**

```bash
# Copy to .env and fill in real values
HYPERDRIVE_ID=
CLOUDFLARE_ACCOUNT_ID=
NEON_CONNECTION_STRING=
```

**Step 6: Create deploy/deploy.sh**

```bash
#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> Building monorepo..."
cd "$ROOT_DIR"
bun run build

echo "==> Building web for Cloudflare Pages..."
cd "$ROOT_DIR/apps/web"
bun run build:cf

echo "==> Deploying server (Cloudflare Workers)..."
cd "$ROOT_DIR"
wrangler deploy --config "$SCRIPT_DIR/server/wrangler.toml"

echo "==> Deploying worker (Cloudflare Workers cron)..."
wrangler deploy --config "$SCRIPT_DIR/worker/wrangler.toml"

echo "==> Deploying web (Cloudflare Pages)..."
wrangler pages deploy \
  "$ROOT_DIR/apps/web/.vercel/output/static" \
  --project-name crikket-web \
  --config "$SCRIPT_DIR/web/wrangler.toml"

echo "==> Done."
```

```bash
chmod +x deploy/deploy.sh
```

**Step 7: Commit the gitignore update only**

The `deploy/` directory itself is gitignored and never committed. Only the `.gitignore` change is committed:

```bash
git add .gitignore
git commit -m "chore: gitignore local deploy/ directory"
```

---

### Task 16: Create Cloudflare infrastructure

**Prerequisites:** `wrangler` must be installed and authenticated. Run `wrangler whoami` to verify.

If wrangler is not installed:
```bash
bun add -g wrangler
wrangler login
```

**Step 1: Create R2 buckets**

```bash
wrangler r2 bucket create crikket-captures
wrangler r2 bucket create crikket-thumbnails
wrangler r2 bucket create crikket-debugger
```

**Step 2: Get your Cloudflare account ID**

```bash
wrangler whoami
```

Note the Account ID — needed for the R2 S3-compatible endpoint URL:
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

**Step 3: Create R2 API token**

In the Cloudflare dashboard → R2 → Manage R2 API Tokens → Create API Token with Edit permissions on all three buckets. Note the Access Key ID and Secret Access Key.

**Step 4: Create Hyperdrive config**

```bash
wrangler hyperdrive create crikket-db \
  --connection-string="<YOUR_NEON_CONNECTION_STRING>"
```

Note the Hyperdrive ID from the output.

**Step 5: Fill in deploy/server/wrangler.toml**

Update `deploy/server/wrangler.toml`:
- Replace `<HYPERDRIVE_ID>` with the ID from Step 4
- Uncomment and fill the `[vars]` entries
- Set `STORAGE_ENDPOINT` to `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- Set `STORAGE_BUCKET` to `crikket-captures`

Do the same for `deploy/worker/wrangler.toml`.

**Step 6: Set secrets**

```bash
wrangler secret put BETTER_AUTH_SECRET --config deploy/server/wrangler.toml
wrangler secret put STORAGE_ACCESS_KEY_ID --config deploy/server/wrangler.toml
wrangler secret put STORAGE_SECRET_ACCESS_KEY --config deploy/server/wrangler.toml
# Add any other secrets (RESEND_API_KEY, POLAR_ACCESS_TOKEN, etc.)
```

---

### Task 17: First deployment

**Step 1: Build the monorepo**

```bash
bun run build
```

Expected: all packages and apps build successfully.

**Step 2: Build the web app for Pages**

```bash
cd apps/web && bun run build:cf
```

Expected: `.vercel/output/static/` is created.

**Step 3: Deploy server Worker**

```bash
wrangler deploy --config deploy/server/wrangler.toml
```

Note the deployment URL (e.g. `https://crikket-server.<subdomain>.workers.dev`).

**Step 4: Update BETTER_AUTH_URL and CORS_ORIGINS**

Update `deploy/server/wrangler.toml` with the actual Workers URL:
```toml
[vars]
BETTER_AUTH_URL = "https://crikket-server.<subdomain>.workers.dev"
```

Re-deploy server if you changed vars:
```bash
wrangler deploy --config deploy/server/wrangler.toml
```

**Step 5: Deploy worker (cron jobs)**

```bash
wrangler deploy --config deploy/worker/wrangler.toml
```

**Step 6: Deploy web to Pages**

```bash
wrangler pages deploy \
  apps/web/.vercel/output/static \
  --project-name crikket-web
```

Note the Pages URL (e.g. `https://crikket-web.pages.dev`).

**Step 7: Update CORS_ORIGINS on the server**

```bash
wrangler secret put CORS_ORIGINS --config deploy/server/wrangler.toml
# Enter: https://crikket-web.pages.dev
```

Re-deploy server:
```bash
wrangler deploy --config deploy/server/wrangler.toml
```

**Step 8: Run database migrations against Neon**

```bash
bun run db:migrate
```

**Step 9: Smoke test**

- Open the Pages URL in a browser
- Verify the app loads and can connect to the server
- Check the Workers logs: `wrangler tail --config deploy/server/wrangler.toml`

---

## Future deployments

After initial setup, redeploy with:
```bash
cd /path/to/crikket && ./deploy/deploy.sh
```
