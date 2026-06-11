# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
bun run dev              # Start all apps (web :3001, server :3000, docs :4000)
bun run dev:web          # Web only
bun run dev:server       # Server only

# Code quality
bun run check            # Lint (Ultracite/Biome)
bun run fix              # Auto-fix linting/formatting
bun run check-types      # TypeScript validation across workspace

# Database
bun run db:push          # Sync schema to DB (dev)
bun run db:generate      # Generate Drizzle migration files
bun run db:migrate       # Run pending migrations
bun run db:studio        # Open Drizzle Studio

# Build
bun run build            # Build all apps
bun run clean            # Remove build artifacts, node_modules, .turbo
bun run kill:ports       # Kill processes on 3000/3001/4000
```

No dedicated test runner is configured at the root level.

## Architecture

Bun + Turborepo monorepo with four apps and ten shared packages.

### Apps

| App | Tech | Port |
|-----|------|------|
| `apps/web` | Next.js 16 / React 19 | 3001 |
| `apps/server` | Hono 4 on Bun | 3000 |
| `apps/docs` | Next.js + Fumadocs | 4000 |
| `apps/extension` | WXT (browser extension) | — |

### Packages

| Package | Purpose |
|---------|---------|
| `packages/api` | ORPC router definitions shared by server and web |
| `packages/auth` | Better-Auth configuration and session helpers |
| `packages/billing` | Polar.sh integration |
| `packages/bug-reports` | Bug report business logic |
| `packages/capture-core` | Core capture logic (shared with extension) |
| `packages/db` | Drizzle ORM schema, migrations, PostgreSQL client |
| `packages/env` | T3 Env validated environment variables |
| `packages/shared` | Site config, types, utilities |
| `packages/ui` | Shadcn/Tailwind component library |
| `packages/config` | Shared ESLint/TS base configs |

### SDK

`sdks/capture` (`@crikket-io/capture`) — embeddable vanilla-JS/React SDK for browser-side capture, published separately.

## Key Patterns

**API layer:** All client-server communication goes through [ORPC](https://orpc.unnoq.com/) procedures defined in `packages/api`. ORPC generates OpenAPI schemas from Zod. The server registers these procedures in `apps/server`; the web app calls them via the ORPC client from `packages/api`.

**Authentication:** Better-Auth (`packages/auth`) handles sessions, organizations, and teams. Polar OAuth is integrated for billing-linked auth flows.

**Storage:** S3-compatible API throughout — supports AWS S3, Cloudflare R2, and MinIO. Both path-style and virtual-hosted addressing are supported (configured via env). Separate buckets for raw captures, thumbnails, and debugger data.

**Environment variables:** All env vars are validated at startup via T3 Env in `packages/env`. There are separate env schemas for server and web. Never access `process.env` directly — import from `@crikket/env`.

**Linting:** Ultracite (opinionated Biome wrapper). Run `bun run fix` before committing — pre-commit hooks enforce this via Husky.

**Releases:** Managed with Changesets (`bun run changeset:add`). The SDK (`sdks/capture`) is versioned and published independently.
