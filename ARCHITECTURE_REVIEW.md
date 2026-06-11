# Crikket — Functional & Architectural Review

Five independent agents reviewed System Architecture, Backend/API, Frontend/UX, SDK & Extension, and Developer Experience. This document covers strengths, weaknesses, and opportunities — security findings are in `REVIEW.md`.

---

## Overall Strengths

### Architecture
- **The ORPC API package is a genuine thin router.** Every router file is a pure map of names to procedures imported from domain packages. No business logic lives in the routing layer.
- **`packages/bug-reports/` is a self-contained domain package.** Business logic (upload sessions, ingestion jobs, artifact cleanup, retry policy, capture key management) lives in `lib/`; the `procedures/` layer is thin orchestration only.
- **`packages/billing/src/model.ts` is exemplary.** All entitlement projection logic, plan configuration, and normalization live in one file of pure functions — independently testable, no framework coupling.
- **The server app is thin.** `apps/server/src/index.ts` handles HTTP wiring, CORS, rate-limit enforcement, and job scheduling. All domain behaviour is delegated to packages.
- **`packages/env/` cleanly isolates environment parsing per runtime target.** Separate `server.ts`, `web.ts`, `extension.ts`, and `polar.ts` files give each consumer access only to the variables it should know about.

### Backend
- **The capture embed pipeline is well-designed end-to-end.** The three-step flow (token → upload-session → finalize) is purpose-built. Layered rate limiting (per-key, per-IP, per-origin) on the public endpoints is one of the strongest operational design decisions in the codebase.
- **Background job infrastructure is correct.** Optimistic locking via `UPDATE … WHERE status IN ('pending','failed') … RETURNING`, exponential back-off, stale-processing recovery (5-minute threshold), and a `dead_letter` terminal state after 5 attempts are all in place. These are the right patterns for a single-process scheduler.
- **Webhook idempotency is thorough.** Polar events are deduplication-claimed with `onConflictDoNothing`, out-of-order delivery is rejected by `event-ordering.ts`, and the fallback ID strategy handles providers without an `id` field.
- **Context auto-populates `activeOrganizationId`** when the session has none, persisting the fallback to the DB and avoiding "no active org" errors on first login.
- **Error codes are genuinely useful.** Fine-grained `reasonCode` values (`missing_public_key`, `replayed_submit_token`, `turnstile_verification_failed`, etc.) make the embed API debuggable.

### Frontend
- **Auth flow is complete and coherent.** Sign-up → OTP verification → dashboard, forgot-password, and invite acceptance all work correctly and are threaded together.
- **React Query is used consistently.** No `useEffect`-based manual fetching anywhere. ORPC query keys are used throughout.
- **URL state (nuqs) is used appropriately.** Filters, sort, tab selection, and network search are all URL-persisted and shareable. Ephemeral UI state stays in `useState`.
- **Lazy data loading in the debugger.** Debugger events and network requests are only fetched when the user first opens the relevant tab — three unnecessary fetches avoided for users who stay on the "Details" tab.
- **Permission model is well-surfaced.** Billing, capture key, and member management gates all show explicit messages rather than silently hiding controls.

### SDK & Extension
- **Comprehensive network instrumentation.** The fetch interceptor handles the `window.fetch` accessor property to interoperate with third-party wrappers. The XHR interceptor patches `open`, `setRequestHeader`, and `send` as a unit. Both share the same body-sanitisation logic.
- **Retention policy is defensively capped.** Per-kind caps (400 actions / 800 console / 1 200 network) inside a global 2 000-event ceiling, with oldest low-priority events dropped first.
- **Screenshot annotation editor is a genuine differentiator.** Canvas-based freehand draw, highlight, and rectangle tools; HiDPI-aware rendering; pointer-capture for reliable drag-end; undo/reset. This is polished beyond comparable SDKs.
- **Extension service-worker resilience.** Session state is persisted to `chrome.storage.local` on a 250 ms debounce and re-hydrated on startup; `tabToSession` cleans up on `chrome.tabs.onRemoved`.

### Developer Experience
- **Testing is behaviour-first where it exists.** Capture route tests drive HTTP handlers with real `Request` objects. The billing webhook mock interpreter simulates the full Drizzle query surface. The SDK test harness isolates browser globals and media APIs correctly.
- **Pre-commit hook is thorough.** Runs `bun run build` → `bun test` → Ultracite formatting, with stash-then-restore for partial staging.
- **Self-host operational tooling is polished.** The setup wizard (`scripts/lib/install-wizard.sh`) is idempotent, validates inputs, generates secrets, backs up existing `.env` files, and dry-runs `docker compose config` before starting. `scripts/healthcheck.sh` does a live HTTP probe.
- **Release process is automated.** Changesets drive SDK versioning; Docker images are published on every merge to `master` with both `sha-` and `latest` tags.

---

## Weaknesses

### Architecture

**A1 — `packages/auth` imports `@crikket/billing` (coupling inversion)**
`packages/auth/src/index.ts` lines 1–3 depend on `packages/billing` to wire hooks (`beforeAcceptInvitation`, `createCustomerOnSignUp`). Billing policy is therefore scattered across two packages, and any future need for billing to call something in auth would create a circular dependency. The server (or a dedicated integrations layer) should wire billing hooks into the auth configuration — not the other way around.

**A2 — Background job scheduling is in-process `setInterval` with no horizontal scaling story**
`apps/server/src/index.ts` lines 147–175 start three `setInterval` loops. The DB-backed job tables anticipate distributed execution, but the trigger mechanism is single-process. If multiple server instances run simultaneously (Docker Swarm, Fly.io), all will run cleanup passes concurrently. Artifact cleanup and orphan cleanup don't use the claim pattern, so they'll do redundant work. Queue depth is invisible — there are no metrics or log lines that show how far behind ingestion has fallen.

**A3 — Extension depends on `@crikket/api` (a server package) just for types**
`apps/extension/package.json` lists `@crikket/api` as a dependency. `@crikket/api` transitively pulls in `@crikket/auth`, `@crikket/billing`, `@crikket/db`, Drizzle ORM, and the AWS S3 SDK — all into a browser bundle that only needs the `AppRouterClient` type. A type-only entry point (e.g., `@crikket/api/types`) would eliminate this entirely.

**A4 — `BugReportDebuggerPayload` is duplicated**
`packages/capture-core/src/debugger/types.ts` line 65 and `sdks/capture/src/types.ts` line 49 both define the same shape. The SDK already depends on `@crikket/capture-core` — it should re-export the type from there.

**A5 — `packages/shared` has server-only code alongside browser-safe code**
`lib/server/orpc-auth.ts` (imports `@orpc/server`) and DB helpers live under the same wildcard export map as browser analytics init and shared constants. The extension and SDK both depend on `@crikket/shared`. Nothing prevents accidentally importing server-only modules from a browser context.

**A6 — No `test` task in `turbo.json`**
`bun run test` at the monorepo root does not exist as a Turbo task, meaning there is no single command to run all tests across the workspace in dependency order.

---

### Backend

**B1 — Ingestion poll ceiling is too low for any real scale**
`BUG_REPORT_INGESTION_INTERVAL_MS = 60_000` with a batch limit of 10 gives a ceiling of 600 completed ingestion jobs per hour. There is no log line showing queue depth on each pass, so a growing backlog is invisible until users start reporting stale bug reports.

**B2 — Dead-letter jobs have no operator surface**
Jobs that reach `dead_letter` status are silently counted in the pass return value and logged only on pass failure. There is no ORPC procedure to query dead-letter jobs, inspect `lastError`, or re-enqueue them. At scale this is a significant operational blind spot.

**B3 — `finalizeBugReportUpload` calls ingestion synchronously inside the request handler**
`upload-session.ts` lines 368–373 call `processBugReportIngestionJob` inline when a debugger payload is present. The HTTP response for `/api/embed/bug-report-finalize` is held open while debugger data is parsed and written to the DB. For large payloads this latency is directly visible to the end-user widget. The async job queue exists precisely to avoid this.

**B4 — `updateBugReport` cannot update `description`**
`update-bug-reports.ts` lines 29–49 accept `title`, `status`, `priority`, `visibility`, and `tags` — but not `description`. The schema has the column, the create path accepts it, but there is no way to correct it after submission. This is a functional gap users will hit immediately.

**B5 — `listBugReports` has no tag filter**
Tags are a first-class concept (shown on cards, settable on create and update) but cannot filter the list. A `tags` filter using PostgreSQL array containment (`@>`) would be the obvious completion.

**B6 — N presigned-URL calls per list page (without `STORAGE_PUBLIC_URL`)**
`list-bug-reports.ts` lines 324–328 fan out `resolveCaptureUrl` per row via `Promise.all`. Without `STORAGE_PUBLIC_URL`, each call makes an HTTPS request to the S3 presigner. For a page of 12 reports that's 12 external calls on the hot path. There is no documentation warning operators about this trade-off.

**B7 — `captureKey.update` and `captureKey.updateOrigins` overlap with no `getById`**
Both procedures can update `allowedOrigins`; `updateCaptureKeyDetails` can also update `label`. The distinction is arbitrary from the caller's perspective. There is also no procedure to fetch a single capture key by ID — only `list`.

**B8 — No API versioning strategy**
There is no version prefix on `/rpc/` routes, no deprecation mechanism, and no changelog for ORPC procedures. The capture SDK calls `/api/embed/*` directly — a breaking change to these routes has no migration path.

---

### Frontend

**F1 — `BugReportView` causes high-frequency re-renders across the entire debugger panel**
`apps/web/src/app/s/[id]/_components/bug-report-view.tsx` (617 lines) holds `playbackOffsetMs` as state. The video `onTimeUpdate` handler sets this at up to 60 Hz. Because `playbackOffsetMs` drives six `useMemo` computations and `BugReportSidebar`, `TimelineList`, and `ReproductionStepsList` all re-render on every change, the entire debugger view re-renders on every video frame tick. This is the most critical performance issue in the frontend.

**F2 — No `Suspense` boundary in the dashboard layout**
`apps/web/src/app/(protected)/(dashboard)/layout.tsx` is a fully blocking async Server Component. There is no `loading.tsx` in the dashboard route group, so the user sees a blank screen until both the org-plan and active-role fetches resolve.

**F3 — No post-onboarding first-run experience**
After org creation the dashboard shows an empty bug-report grid with "Start reporting bugs to see them here." There is no prompt to navigate to Settings → Public Keys to create a capture key. A new user has no clear next step.

**F4 — Client-side member search fetches unbounded data**
`apps/web/src/app/(protected)/(dashboard)/settings/organization/page.tsx` lines 82–128: when a search term is present, the code fetches the total count then re-fetches *all* members to filter in JS. For large organisations this retrieves the entire member table on every keystroke.

**F5 — `queryClient.invalidateQueries()` with no filter on key mutations**
`use-public-key-actions.ts` lines 13, 23, 33, 43, 53: every capture key create/update/delete/rotate/revoke invalidates every cached query in the app. The bug report list, stats, and all other active queries refetch after a key operation.

**F6 — Network request and timeline lists are not virtualized**
`NetworkRequestsPanel` and `TimelineList` render every loaded row as a DOM node. Sessions with hundreds of XHR calls or actions will produce an equivalent number of DOM nodes with no virtual windowing.

**F7 — Invitation page shows no org name**
`apps/web/src/app/invite/[invitationId]/` shows only "Organization Invitation" — the org name is not fetched or displayed. A user receiving the invite link cannot tell which org they are joining before accepting.

---

### SDK & Extension

**S1 — No upload retry or offline queuing**
A transient network error during the S3 PUT propagates immediately as a thrown error — no retry, no back-off, no offline queue. Because the upload session was already created on the server, the user's only recourse is to start a new capture, losing the recording.

**S2 — `CaptureSubmissionDraft.visibility` is silently discarded**
`sdks/capture/src/runtime/submit-captured-report.ts` line 29 hard-codes `visibility: BUG_REPORT_VISIBILITY_OPTIONS.private`. The extension's `bug-report-upload.ts` line 43 does the same. The `visibility` field is present in the public type and exposed in the review form, but it is never used. Developers who set `visibility: "public"` will see it ignored with no error.

**S3 — `LazyCaptureSdkRuntime.loadEagerRuntimeModule` is not actually lazy**
`sdks/capture/src/runtime/lazy-capture-runtime.ts` line 16 statically imports `CaptureSdkRuntime`. The entire React widget, all debugger code, and all UI components are in the same bundle as the lazy runtime. The lazy-loading architecture exists in code structure but delivers no bundle-size benefit until this is a real dynamic `import()`.

**S4 — `console.*` instrumentation is never fully uninstalled**
`installConsoleCapture` replaces `console.log/info/warn/error/debug` but stores no reference to the originals. After `capture.destroy()` + re-init, the `INSTALL_FLAG` on `window` is not cleared, so console capture is silently skipped on the second init while network/action capture re-activates — asymmetric state.

**S5 — No `onSuccess`/`onError` lifecycle callbacks**
`CaptureInitOptions` has no callback hooks. Developers cannot be notified when a report is successfully submitted (to fire analytics, send a Slack notification, etc.) without replacing `defaultSubmitTransport` entirely. This is the most commonly requested integration hook in comparable SDKs.

**S6 — No maximum recording duration**
The recording dock has no timeout. A user who starts a recording and walks away will accumulate a blob that may far exceed the 95 MB guard and receive a confusing error at submission time.

---

### Developer Experience

**D1 — No CI test step**
The three workflow files (`docker-publish.yml`, `publish.yml`, `version-packages.yml`) build, type-check, and lint — but none runs the test suite. A regression in any tested package is not caught in CI.

**D2 — `apps/server` has no `test` script despite having two test files**
`apps/server/package.json` has no `"test"` entry. The tests in `apps/server/test/` are invisible to any tooling relying on the standard script name.

**D3 — No structured logging**
All server-side observability is `console.*`. The scheduled jobs, ORPC error interceptors, and capture security logs all emit unstructured output. An operator watching `docker compose logs -f server` cannot grep by severity, correlation ID, or job ID.

**D4 — `reportNonFatalError` only calls `console.warn`**
`packages/shared/src/lib/errors.ts`: the function's name implies an external error tracker hook point, but the implementation is just `console.warn` with `once` deduplication. Repeated errors are silently dropped after the first occurrence.

**D5 — No request correlation ID**
There is no `x-request-id` header propagation and no correlation token in error logs. Tying a user-reported failure to a specific log line requires guessing from timestamp and endpoint alone.

**D6 — `apps/web/tsconfig.json` does not inherit from the base config**
The web app misses `noUnusedLocals`, `noUnusedParameters`, and `noUncheckedIndexedAccess` — the strictest guards that all packages benefit from.

**D7 — No seed script**
`packages/db` has only schema and migrations. A fresh local instance requires manually creating an organisation, public key, and sample bug report before the application is usable. `CONTRIBUTING.md` does not acknowledge this.

---

## Opportunities (Priority Order)

### High impact

1. **Add a `test` task to `turbo.json` and a CI workflow step.** One Turbo task, a `"test"` script in `apps/server/package.json`, and a `turbo run test` step in CI closes the largest quality gap with minimal effort.

2. **Move finalize-time debugger ingestion to the async job queue.** The embed finalize response becomes instantaneous. The `retryBugReportDebuggerIngestion` ORPC procedure already exists for manual retries. Client-side polling on `debuggerIngestionStatus` can drive the UX.

3. **Add upload retry logic in the SDK.** A single retry with 1–2 second back-off for the S3 PUT dramatically improves reliability on flaky connections. The existing upload session ID can be reused, avoiding duplicate server-side records.

4. **Introduce structured JSON logging.** A thin `pino` wrapper (or even `JSON.stringify`) on the server makes logs machine-parseable for any log aggregator (Loki, CloudWatch, Datadog) without a parsing step.

5. **Wire `reportNonFatalError` to an external error tracking hook.** Export a `setErrorReporter(fn)` callback; keep `console.warn` as the default. Self-hosters opt in; the hosted product wires in Sentry or equivalent.

### Medium impact

6. **Extract `BugReportView` into smaller components with `Suspense` boundaries.** Moving `playbackOffsetMs` into a ref (or a separate context), and splitting the loading / loaded / missing states into proper named components, eliminates the 60 Hz full-tree re-render.

7. **Add a post-onboarding "Quick Start" card.** A contextual prompt to `/settings/keys` after org creation converts the empty state into a guided action. This is the highest-impact UX improvement given the product's SDK-driven nature.

8. **Invert the `auth → billing` dependency.** Wire billing hooks into auth configuration in the server (or a dedicated integrations module) rather than having `packages/auth` depend on `packages/billing`.

9. **Expose a type-only entry point for `@crikket/api`.** A `@crikket/api/types` export that re-exports `AppRouterClient` and `AppRouter` without pulling in any runtime code eliminates the server dependency tree from the extension bundle.

10. **Add `description` to `updateBugReport` and a `tags` filter to `listBugReports`.** Both are obvious day-one requests that the schema already supports.

### Lower impact / longer term

11. **Define an API versioning strategy** before general availability. At minimum, a stable-API policy for `/api/embed/*` routes that the capture SDK depends on.

12. **Replace `setInterval` scheduling with a proper job queue** (pg-boss, Inngest, or Trigger.dev). The DB-backed job tables already anticipate distributed execution; the trigger mechanism is the only piece that doesn't.

13. **Add `onSuccess`/`onError` lifecycle callbacks to `CaptureInitOptions`.** Enables server-side integrations without requiring `submitTransport` replacement.

14. **Virtualize `TimelineList` and `NetworkRequestsPanel`** with TanStack Virtual. Necessary for sessions with hundreds of events.

15. **Add a seed script** (`packages/db/src/seed.ts`) with one org, one user, one public key, and one sample bug report to reduce time-to-understanding for new contributors.

16. **Add a `/readyz` endpoint** that checks DB connectivity (`SELECT 1`) to give the Docker health check and uptime monitors a meaningful signal beyond HTTP listener readiness.

17. **Add configurable theming tokens to the SDK.** An `theme` object in `CaptureInitOptions` mapped to CSS custom properties injected into the Shadow DOM is the minimal version of customer branding support.

18. **Document the dead-letter runbook.** The `debuggerIngestionError`, `lastError`, and `retryBugReportDebuggerIngestion` surface is present but undocumented. An operator facing a stuck report has no path to self-diagnosis without reading source.
