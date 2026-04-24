# Cloudflare Deployment Design

**Date:** 2026-04-24  
**Status:** Approved

## Goal

Deploy the full Crikket stack to Cloudflare using a gitignored local `deploy/` directory — no deployment config in the main codebase. Manual deployments only; no CI/CD.

## Scope

| App | Target |
|-----|--------|
| `apps/server` | Cloudflare Workers |
| `apps/web` | Cloudflare Pages |
| `apps/worker` (new) | Cloudflare Workers with cron triggers |
| `apps/docs` | Not deployed |

**Database:** Neon PostgreSQL via Cloudflare Hyperdrive  
**Storage:** Cloudflare R2 (already supported by the codebase)

---

## Approach: Gitignored `deploy/` directory (Approach A)

All Cloudflare configuration lives in `deploy/` at the monorepo root, added to `.gitignore`. The main codebase stays clean — no `wrangler.toml` files in `apps/*`, no CI workflows.

```
crikket/
  apps/                  ← untouched
  packages/              ← untouched
  deploy/                ← gitignored, local only
    server/
      wrangler.toml
    worker/
      wrangler.toml
    web/
      wrangler.toml
    .env
    deploy.sh
```

**Deployment flow:**
1. `bun run build` in the monorepo root
2. `cd deploy && ./deploy.sh` — runs `wrangler deploy` for server + worker, `wrangler pages deploy` for web

---

## Cloudflare Infrastructure (one-time setup)

Create before first deploy using the `wrangler` CLI:

1. **Hyperdrive config** — wraps the Neon connection string  
   `wrangler hyperdrive create crikket-db --connection-string="<neon-url>"`
2. **R2 buckets** — raw captures, thumbnails, debugger data  
   `wrangler r2 bucket create crikket-captures`  
   `wrangler r2 bucket create crikket-thumbnails`  
   `wrangler r2 bucket create crikket-debugger`

---

## Wrangler Config Details

### `deploy/server/wrangler.toml`
- `main` → built output from `apps/server`
- `nodejs_compat = true`
- Hyperdrive binding `DB`
- R2 bindings for three storage buckets
- `BACKGROUND_JOBS = "disabled"` (jobs run in the worker instead)
- All server env vars in `[vars]` or as secrets

### `deploy/worker/wrangler.toml`
- `main` → built output from `apps/worker`
- `nodejs_compat = true`
- Hyperdrive binding `DB`
- Three cron triggers:
  - `*/5 * * * *` → artifact cleanup
  - `* * * * *` → bug report ingestion
  - `0 * * * *` → orphan cleanup

### `deploy/web/wrangler.toml`
- Cloudflare Pages project
- Build output from `@cloudflare/next-on-pages` transform of `apps/web`
- `nodejs_compat = true`
- All `NEXT_PUBLIC_*` env vars

---

## Implementation Sequence

1. Rename `master` → `main`; update GitHub default branch
2. Merge PR #1 (GitHub integration — fully implemented)
3. Merge PR #2 (project entity — depends on #1)
4. Merge PR #3 (hosting flexibility docs)
5. Implement hosting flexibility code changes (5 workstreams per approved design):
   - DB driver swap (`pg` → `postgres.js`, `createDb` factory)
   - Web API refactor (`crypto.subtle`, `DecompressionStream`, `is-ip`)
   - Env abstraction (`createServerEnv` factory)
   - Background jobs extraction (`packages/jobs`, `apps/worker`)
   - Server Workers adapter (Hono Workers entry point)
6. Add `@cloudflare/next-on-pages` to `apps/web`
7. Create `deploy/` directory with wrangler configs and `deploy.sh`
8. Create Cloudflare infrastructure (Hyperdrive, R2 buckets) via `wrangler` CLI
9. First deployment

---

## Non-Goals

- CI/CD (deployments are manual, local only)
- Deploying `apps/docs`
- Cloudflare D1 or KV (stays on Neon PostgreSQL)
- Migrating existing data
