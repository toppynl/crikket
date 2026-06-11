# Crikket — Full Project Review

Five independent agents reviewed Backend/API, Frontend/Web, Database, Security/Infrastructure, and SDK/Extension/Monorepo.

---

## Overall Strengths

- **Multi-tenant isolation is airtight.** Every query composes `organizationId` alongside any row-specific predicate. Billing privilege checks hit the DB directly, not the session payload.
- **Capture embed pipeline has defence-in-depth.** Three independent guards: public key + origin allowlist, HMAC-signed jti-bearing tokens with Redis replay protection, optional Turnstile with hostname binding.
- **Rate limiting is layered and well-targeted.** Dual IP + per-user limits on the RPC API; three independent limiters on capture embed routes; fail-open with throttled logging for the Redis dependency.
- **Job queue atomicity.** `claimBugReportIngestionJob` uses a single `UPDATE … WHERE … RETURNING` — no preceding SELECT, no double-claim.
- **SDK security fundamentals are solid.** Shadow DOM isolation, thorough PII/credential scrubbing in the network capturer (headers, bodies, query params), bounded per-kind event retention, recursion guard in the fetch patcher.
- **Env var separation is clean.** T3 Env keeps all secrets server-side; a Biome rule hard-errors on importing the server auth package from `apps/web`.
- **Developer ergonomics.** Workspace catalog pins all shared deps in one place; ORPC + Zod give end-to-end type safety from DB schema through to client form validation.

---

## Critical Issues

### SEC-C1 — PostgreSQL defaults to unauthenticated `trust` mode
**`docker-compose.yml` line 10**

```yaml
POSTGRES_HOST_AUTH_METHOD: ${POSTGRES_HOST_AUTH_METHOD:-trust}
```

The fallback is `trust` (no password). Combined with the port being published to `0.0.0.0:5432` (line 12), anyone with network access to the host can connect with no credentials. The `.env.example` says `scram-sha-256`, creating a false sense of security.

**Fix:** Change the compose fallback to `scram-sha-256` and bind the port to `127.0.0.1:5432` by default.

---

### SEC-C2 — Docker containers run as root
Neither `apps/server/Dockerfile` nor `apps/web/Dockerfile` has a `USER` directive. The `oven/bun` base image runs as root. Any RCE vulnerability inside either container yields full root on the host.

**Fix:** Add a non-root user before `CMD`/`ENTRYPOINT` in both Dockerfiles.

---

### SEC-C3 — Unrestricted `chrome-extension://` CORS
**`apps/server/src/index.ts` line 114**

```ts
if (origin.startsWith("chrome-extension://")) return origin
```

This grants `credentials: true` CORS to *any* browser extension. A malicious third-party extension can make credentialed requests to the API and read session data.

**Fix:** Allowlist the specific Crikket extension ID, or require the extension to use an API key instead of cookies.

---

### SDK-C1 — `window.postMessage` uses `"*"` target origin
**`packages/capture-core/src/debugger/engine/page/event-queue.ts` line 26**

```ts
window.postMessage({ source: PAGE_SOURCE, events: batchedEvents }, "*")
```

Debugger events — network URLs, request/response bodies, console logs — are broadcast to every origin. Any cross-origin `<iframe>` on the host page (ads, analytics, third-party widgets) receives this stream. This is a concrete data exfiltration path.

**Fix:** Replace `"*"` with `location.origin`.

---

### DB-C1 — Un-transacted two-table failure write in ingestion
**`packages/bug-reports/src/lib/ingestion-jobs.ts` lines 397–430**

`markBugReportIngestionJobFailure` updates `bug_report` then `bug_report_ingestion_job` in two separate `await db.update()` calls. A crash between them leaves the bug report permanently stuck in `failed` while the job row still shows `processing` — it will never be retried.

**Fix:** Wrap both updates in a single `db.transaction()`.

---

### DB-C2 — Critical work outside the upload finalization transaction
**`packages/bug-reports/src/lib/upload-session.ts`**

The transaction at line 334 correctly atomizes the bug-report insert and session deletion. But `finalizeBugReportDebuggerIngestion` (line 368) and the final `submissionStatus` update (lines 385–391) run *outside* it. A crash after the transaction commits leaves the report permanently in `processing` with no recovery path.

**Fix:** Extend the transaction to cover all three steps.

---

## Important Issues

### Security

**SEC-I1 — Email verification disabled**
`packages/auth/src/index.ts`: `requireEmailVerification: false`, `sendOnSignUp: false`. Users can register claiming an email they don't control, bypassing `ALLOWED_SIGNUP_DOMAINS` allowlists. The OTP infrastructure is already wired in — this is a config toggle.

**SEC-I2 — `captureContentType` is caller-controlled with no allowlist**
`packages/bug-reports/src/lib/upload-session.ts` line 72 accepts any string. This flows into the S3 `PutObjectCommand` `ContentType`. A caller can upload `text/html` or `application/javascript` files that get served with browser-executable content types.

**Fix:** Allowlist to `["video/webm", "image/png", "image/jpeg"]`.

**SEC-I3 — `thumbnailUrl` stored and returned verbatim from user-controlled metadata**
The capture extension supplies `thumbnailUrl`; the server stores it and returns it to all API consumers. Clients rendering it as `<img src>` leak IP/browser info to an attacker-controlled origin.

**Fix:** Restrict to URLs matching `STORAGE_PUBLIC_URL` origin only.

**SEC-I4 — Presigned PUT URLs inherit the 7-day GET TTL**
`packages/bug-reports/src/lib/storage.ts` line 48: a single `604_800`s constant is used for both upload and download URLs. Intercepted PUT URLs remain valid for a week.

**Fix:** Use a separate 5–15 minute TTL for PUT URLs.

**SEC-I5 — `recomputeEntitlements` uses a loose string comparison against a nullable field**
`packages/billing/src/procedures/recompute-entitlements.ts` line 14 checks `context.session.user.role !== "admin"` against a `string | null | undefined` field. If role values change or are extended, this breaks silently without a type error.

---

### Database

**DB-I1 — Wrong default for `debugger_ingestion_status`**
`packages/db/src/schema/bug-report.ts` line 41: column defaults to `'completed'`. Application code always sets it explicitly to `'not_uploaded'` on insert, but any direct SQL insert, migration, or test that omits the field gets a semantically wrong value.

**DB-I2 — No composite unique constraint on `member(organizationId, userId)`**
Nothing at the DB level prevents duplicate membership rows. A bug or direct SQL insert could create two rows for the same user/org, causing unpredictable behaviour in role checks.

**Fix:** Add `uniqueIndex` on `(organization_id, user_id)`.

**DB-I3 — 50 S3 presign calls per list page**
`listBugReports` fans out `resolveCaptureUrl` via `Promise.all` for every row on the page. With a default page size of 50, that's 50 individual S3 SDK calls per request.

**Fix:** Store presigned URLs at upload time (already done for some thumbnails) and refresh on TTL.

**DB-I4 — All timestamps are `TIMESTAMP WITHOUT TIME ZONE`**
Works in practice (Node always uses UTC), but any client connecting with a non-UTC `timezone` GUC will misinterpret stored values.

**Fix:** Use `timestamp({ withTimezone: true })` throughout.

**DB-I5 — Double query in `getBugReportById` and all three debugger procedures**
`packages/bug-reports/src/procedures/get-bug-report.ts`: `assertBugReportAccessById` fetches a subset of the row, then the handler fetches the full row again with joins. The access check result is discarded. This doubles read cost on the hottest endpoint.

---

### Frontend

**FE-I1 — Global `queryClient.invalidateQueries()` on every capture key mutation**
`apps/web/src/app/(protected)/(dashboard)/settings/_components/public-keys/hooks/use-public-key-actions.ts` lines 13, 22, 33, 42, 51: every key create/update/delete/rotate/revoke invalidates *all* cached queries in the app, including the bug reports list.

**Fix:** Scope to `orpc.captureKey.list.queryKey()`.

**FE-I2 — Member search fetches unbounded data client-side**
`apps/web/src/app/(protected)/(dashboard)/settings/organization/page.tsx` lines 82–127: when a search term is present, the code fetches the total count then re-fetches *all* members to filter in JS. For large organisations this retrieves the entire member table on each keystroke.

**FE-I3 — Wildcard Next.js image `remotePatterns`**
`apps/web/next.config.ts` lines 8–14: `hostname: "**"` allows the Next.js image proxy to fetch from any host, including internal services. This is an SSRF vector.

**Fix:** Restrict to known storage/CDN hostnames.

**FE-I4 — `ResizablePanel` receives pixel strings instead of percentage numbers**
`apps/web/src/app/s/[id]/_components/bug-report-view.tsx` lines 311, 322–326: `"720px"`, `"420px"` etc. are passed as `minSize`/`defaultSize` props. `react-resizable-panels` expects fractional percentages; the layout may silently misbehave on library updates.

**FE-I5 — `queryClient` is a module-level singleton**
`apps/web/src/utils/orpc.ts` lines 10–21: `queryClient` is created at module scope. The safer pattern is to instantiate it inside `Providers` using `useState` or `useRef`.

---

### SDK / Monorepo

**SDK-I1 — Lazy loading is not actually lazy**
`sdks/capture/src/runtime/lazy-capture-runtime.ts` line 16 statically imports `CaptureSdkRuntime`. The entire heavy runtime — React, all UI, all debugger code — is bundled at module load time. `loadEagerRuntimeModule` resolves immediately. The architecture exists in code structure but delivers no bundle-size benefit.

**Fix:** Replace with a real dynamic `import("./capture-runtime")`.

**SDK-I2 — `visibility` field silently ignored, always set to `"private"`**
`sdks/capture/src/runtime/submit-captured-report.ts` line 29 hard-codes `visibility: BUG_REPORT_VISIBILITY_OPTIONS.private` regardless of what the user selected in the widget form.

**SDK-I3 — `packages/shared` mixes server-only and browser-safe code**
The package exports `lib/server/orpc-auth.ts` (imports `@orpc/server`), DB helpers, and browser analytics init under the same wildcard export map. The extension and SDK both depend on `@crikket/shared`. A Biome guard only blocks `@crikket/auth` imports in `apps/web`, not `@crikket/shared/lib/server/*`.

**Fix:** Split into a `server/` sub-package.

**SDK-I4 — Extension requests `<all_urls>` host permissions**
`apps/extension/wxt.config.ts` line 36. The manifest grants visibility into all browsing, triggering install warnings. Consider optional permissions or more targeted host matching.

**SDK-I5 — `capture-core/package.json` exports raw TypeScript source for one entry point**
The `./upload/client` export resolves to `./src/upload/client.ts` (not `dist/`). Non-Bun toolchains or bundlers without TypeScript resolution will fail to load this entry point at runtime.

---

## Minor Issues

| Area | File | Issue |
|------|------|-------|
| Backend | `apps/server/src/capture/shared.ts:73` | Raw `Error.message` sent to clients in catch-all handler — may leak DB host/table names |
| Backend | `apps/server/src/capture/shared.ts:89` | `authorizeCaptureSubmitRequest` mixes `throw` and `return Response` for error signalling |
| Backend | `apps/server/src/index.ts:200` | Content-Length guard skipped when header is absent (streaming bypass) |
| Backend | `apps/server/src/capture/shared.ts:16` | `AuthorizedCaptureRequest` has redundant duplicate fields `keyId`/`publicKeyId` |
| Database | `packages/bug-reports/src/lib/capture-public-key.ts:361` | `deleteCapturePublicKey` uses SELECT-then-DELETE; use `DELETE … RETURNING` instead |
| Database | `packages/bug-reports/src/lib/ingestion-jobs.ts:262` | Ingestion pass processes jobs sequentially; bounded concurrency would reduce backlog time |
| Database | `packages/bug-reports/src/lib/debugger.ts` | `bugReportLog`/`bugReportAction` loaded in entirety (up to 2 000 rows each) with no pagination |
| Frontend | `apps/web/src/components/providers.tsx:7` | `ReactQueryDevtools` unconditionally included in production bundle |
| Frontend | `apps/web/src/app/(protected)/(dashboard)/_components/bug-reports/bug-report-card.tsx:228` | `toLocaleString()` without locale arg causes hydration mismatches |
| Frontend | `apps/web/src/components/auth/sign-in-form.tsx:43` | `callbackURL` default fallback is the full `APP_URL` rather than `/` |
| Frontend | `apps/web/src/components/team-switcher.tsx:96` | `console.error` in catch blocks; should use `reportNonFatalError` like the rest of the codebase |
| SDK | `apps/extension/lib/bug-report-debugger/content.ts:26` | `BATCH_SIZE`/`FLUSH_INTERVAL_MS` duplicated from `capture-core/constants`; import instead |
| SDK | `sdks/capture/react.js` | Proxy shim committed to source; should be a build artifact |
| SDK | `biome.jsonc:10` | `sdks/` directory excluded from Biome linting entirely |
| SDK | `sdks/capture/src/utils.ts:105` | `navigator.platform` is deprecated and a fingerprinting vector; use `userAgentData.platform` |
| SDK | `sdks/capture/src/plugin.tsx:41` | `props.submitTransport`/`props.mountTarget` in `useEffect` deps will re-initialize SDK on every render if passed as inline values |
| Infra | `packages/billing/src/procedures/context.ts` | `BillingSessionContext` defines its own session shape instead of deriving from the canonical type |

---

## Priority Order

### Fix immediately (security / data integrity)
1. SEC-C1 + SEC-C1/I3 — PostgreSQL `trust` default + world-accessible port
2. SEC-C2 — Containers running as root
3. SEC-C3 — Unrestricted `chrome-extension://` CORS
4. SDK-C1 — `window.postMessage` with `"*"` target origin
5. DB-C1 — Un-transacted ingestion failure write
6. DB-C2 — Upload finalization work outside transaction

### Fix before wider deployment
7. SEC-I1 — Enable email verification
8. SEC-I2 — `captureContentType` allowlist
9. SEC-I3 — `thumbnailUrl` origin restriction
10. SEC-I4 — Separate TTL for presigned PUT URLs
11. DB-I2 — Unique constraint on `member(organizationId, userId)`
12. SDK-I2 — `visibility` field ignored in submission

### Fix for scale
13. DB-I3 — N+1 S3 presign calls in `listBugReports`
14. FE-I1 — Overbroad `queryClient.invalidateQueries()`
15. FE-I2 — Unbounded member search fetch
16. SDK-I1 — Fake lazy loading (bundle size)

### Fix for correctness / hygiene
17. DB-I1 — Wrong `debugger_ingestion_status` column default
18. DB-I4 — `TIMESTAMPTZ` migration
19. DB-I5 — Double query in `getBugReportById`
20. FE-I3 — Wildcard image `remotePatterns` (SSRF)
21. FE-I4 — `ResizablePanel` pixel string props
22. SDK-I3 — Split `packages/shared` server/browser boundary
23. SDK-I5 — `capture-core` raw TS source export
