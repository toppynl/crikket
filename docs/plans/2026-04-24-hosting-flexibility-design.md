# Hosting Flexibility Design

**Date:** 2026-04-24  
**Status:** Approved

## Goal

Make the server deployable to serverless/edge platforms (Cloudflare Workers, AWS Lambda, Google Cloud Run) while keeping the existing self-hosted/Docker path fully working. Preference is towards serverless targets.

## Approach: Option B — Driver swap + Web API refactor + externalized jobs

Five independent workstreams with no behavior changes.

---

## 1. Database Layer

**Change:** Replace `pg` (node-postgres) with `postgres.js` in `packages/db`.

- Drizzle switches from `drizzle-orm/node-postgres` to `drizzle-orm/postgres-js`
- Connection string stays the same for all non-Workers targets
- For Cloudflare Workers: Hyperdrive binding (`env.DB.connectionString`) becomes the connection string at request time
- `packages/db/src/index.ts` exports a `createDb(connectionString)` factory instead of a module-level singleton
  - Traditional targets (Cloud Run, Lambda, Bun server): call once at startup
  - Workers: call per-request with the Hyperdrive connection string
- `db` is passed through Hono context — no import changes in `packages/api`, `packages/bug-reports`, etc.
- `drizzle-kit` uses `pg` internally for migrations only — unaffected at runtime
- Better Auth's Drizzle adapter is driver-agnostic — no changes needed

---

## 2. Web API Refactor

Replace four `node:*` usages with portable Web API equivalents. No behavior changes.

| File | Current | Replacement |
|------|---------|-------------|
| `packages/api/src/rate-limit.ts` | `node:crypto` `createHash` | `crypto.subtle.digest('SHA-256', ...)` (async) |
| `packages/api/src/rate-limit.ts` | `node:net` `isIP()` | `is-ip` package (pure JS, no native deps) |
| `packages/bug-reports/src/lib/ingestion-jobs.ts` | `node:zlib` `gunzipSync` | `DecompressionStream('gzip')` via Web Streams |
| `packages/billing/src/service/polar-payload.ts` | `node:crypto` `createHmac` | `crypto.subtle.verify` with HMAC-SHA256 |

`crypto.subtle` changes are async but all call sites are already inside async handlers.

---

## 3. Environment Variable Abstraction

**Problem:** `packages/env` uses `runtimeEnv: process.env` from `@t3-oss/env-core`. Cloudflare Workers exposes env vars as bindings on the handler's `env` argument, not via `process.env`.

**Solution:** Export a `createServerEnv(runtimeEnv)` factory from `packages/env` alongside the existing `env` singleton.

- Traditional targets (Bun server, Cloud Run, Lambda): continue importing `env` — no changes anywhere
- Cloudflare Workers: `fetch`/`scheduled` handler calls `createServerEnv(bindings)` once per invocation and passes it through Hono context
- Avoids a global refactor of every `env.SOMETHING` reference in the codebase

---

## 4. Background Jobs

**Problem:** Three `setInterval` calls in `apps/server/src/index.ts` assume a long-lived process. Incompatible with request-scoped serverless runtimes.

### Core package

**`packages/jobs`** — new package, re-exports the three existing job functions from `packages/bug-reports` as a clean public API:
- `runArtifactCleanupPass()`
- `runBugReportIngestionPass()`
- `runStalePendingBugReportCleanupPass()`

### Four deployment modes

**Native (self-hosted, current behavior):**  
`apps/server` keeps `setInterval` guarded by `BACKGROUND_JOBS=native`. This is the default — existing deployments are unaffected.  
Set `BACKGROUND_JOBS=disabled` when using any platform adapter.

**Cloudflare Workers (`apps/worker`):**  
New Cloudflare Worker with a `scheduled` export. Three cron triggers in `wrangler.toml`:
- `*/5 * * * *` → artifact cleanup
- `* * * * *` → bug report ingestion  
- `0 * * * *` → orphan cleanup

**AWS Lambda (`apps/jobs-lambda`):**  
Lambda handler triggered by EventBridge scheduled rules. Event payload carries `{ "job": "artifact-cleanup" | "ingestion" | "orphan-cleanup" }`. Single handler routes to the right function.

**Google Cloud Run (`apps/jobs-cloudrun`):**  
Cloud Run Job container (run-to-completion model). Cloud Scheduler creates three jobs pointing at the same container image, differentiated by a `JOB` env var. Container runs the job and exits.

---

## 5. Deployment Configs

### Cloudflare Workers (`apps/server/wrangler.toml`)
- Hyperdrive binding `DB` pointing at PostgreSQL connection string
- `nodejs_compat = true` as safety net for transitive deps
- `BACKGROUND_JOBS = "disabled"`

### `apps/worker/wrangler.toml`
- Three cron triggers (see above)
- Same Hyperdrive binding for database access

### Cloud Run (`apps/server/Dockerfile`)
- Existing Dockerfile works as-is
- Ensure Hono listens on `process.env.PORT` (Cloud Run injects this)
- Set `BACKGROUND_JOBS=disabled` when deploying alongside `apps/jobs-cloudrun`

### `apps/jobs-cloudrun/Dockerfile`
- Same base image as `apps/server`
- Entry point runs a single job pass and exits
- JOB env var selects which function to run

### AWS Lambda
- `apps/server` wrapped with `@hono/aws-lambda` for API Gateway integration
- `apps/jobs-lambda` deployed as a separate Lambda function
- EventBridge rules trigger jobs on schedule

---

## File Impact Summary

| File / Package | Change |
|----------------|--------|
| `packages/db/src/index.ts` | Replace `pg` with `postgres.js`, export `createDb` factory |
| `packages/db/package.json` | Remove `pg`, add `postgres` |
| `packages/api/src/rate-limit.ts` | `crypto.subtle` + `is-ip` |
| `packages/api/package.json` | Add `is-ip` |
| `packages/bug-reports/src/lib/ingestion-jobs.ts` | `DecompressionStream` |
| `packages/billing/src/service/polar-payload.ts` | `crypto.subtle` |
| `packages/env/src/server.ts` | Export `createServerEnv` factory |
| `apps/server/src/index.ts` | Gate `setInterval` behind `BACKGROUND_JOBS=native` |
| `apps/server/wrangler.toml` | New file |
| `packages/jobs/` | New package |
| `apps/worker/` | New Cloudflare Worker app |
| `apps/jobs-lambda/` | New Lambda handler app |
| `apps/jobs-cloudrun/` | New Cloud Run job app |

---

## Non-Goals

- Switching database provider (stays on PostgreSQL)
- Migrating existing data
- Changing the web app (`apps/web`) — it deploys independently to Vercel/similar
- Supporting Cloudflare D1 or other non-Postgres databases
