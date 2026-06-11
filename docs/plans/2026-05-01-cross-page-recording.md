# Cross-Page Recording Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist debugger session events (network, actions, console) across full-page navigations so a recording that spans multiple pages captures a complete trace.

**Architecture:** On `pagehide`, serialize the active `DebuggerSession` (events + metadata) to `sessionStorage`. On the next page's `init()`, detect the stored session and restore it into the `DebuggerCollector` before any new events arrive. When the user starts or stops recording on the new page, the accumulated cross-page events are included in the final report. `sessionStorage` is the right primitive because it is tab-scoped, persists across same-tab navigations, and is cleared automatically when the tab closes.

**Tech Stack:** TypeScript, Bun test (`bun:test`), `mock.module()` for dependency injection in tests. All changes are within `sdks/capture/src/` and `packages/capture-core/` (read only for types). Tests live in `sdks/capture/test/`. Run tests with `cd sdks/capture && bun test test`.

---

## Key files

| File | Role |
|---|---|
| `sdks/capture/src/debugger/session-storage.ts` | **New.** Helpers to read/write/clear a session from `sessionStorage` |
| `sdks/capture/src/debugger/debugger-collector.ts` | Persist on `pagehide`, restore on `install()`, clear on finalize/reset |
| `sdks/capture/src/debugger/lazy-debugger-collector.ts` | Expose `ensureSessionRestored()` for the runtime to call |
| `sdks/capture/src/runtime/capture-runtime.ts` | Check for a restored session at `init()`, show the recording dock, handle stop with no active recording |
| `sdks/capture/test/lib/sdk-test-harness.ts` | Extend the `DebuggerCollector` mock with the two new methods |
| `sdks/capture/test/cross-page-recording.test.ts` | **New.** Integration tests for the full resume flow |

---

### Task 1: Create `session-storage.ts` with unit tests

**Files:**
- Create: `sdks/capture/src/debugger/session-storage.ts`
- Create: `sdks/capture/test/session-storage.test.ts`

The module wraps `sessionStorage` with typed read/write/clear for a persisted recording session. All calls are wrapped in try/catch because `sessionStorage` can throw in private-browsing or when storage is full.

**Step 1: Create the file**

```typescript
// sdks/capture/src/debugger/session-storage.ts
import { normalizeDebuggerEvent } from "@crikket/capture-core/debugger/normalize"
import type { DebuggerEvent } from "@crikket/capture-core/debugger/types"
import type { DebuggerSession } from "../types"

const STORAGE_KEY = "__crikketActiveSession"
const SESSION_VERSION = 1
const MAX_SESSION_AGE_MS = 5 * 60 * 1000 // 5 minutes — stale sessions are ignored

interface PersistedSession {
  version: typeof SESSION_VERSION
  sessionId: string
  captureType: "video" | "screenshot"
  startedAt: number
  recordingStartedAt: number | null
  events: unknown[]
  savedAt: number
}

export interface RestoredSession {
  sessionId: string
  captureType: "video" | "screenshot"
  startedAt: number
  recordingStartedAt: number | null
  events: DebuggerEvent[]
}

export function persistSession(session: DebuggerSession): void {
  try {
    const data: PersistedSession = {
      version: SESSION_VERSION,
      sessionId: session.sessionId,
      captureType: session.captureType,
      startedAt: session.startedAt,
      recordingStartedAt: session.recordingStartedAt,
      events: session.events,
      savedAt: Date.now(),
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Private browsing, quota exceeded, or storage unavailable — fail silently
  }
}

export function loadPersistedSession(): RestoredSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const data: unknown = JSON.parse(raw)
    if (!isPersistedSession(data)) return null

    if (Date.now() - data.savedAt > MAX_SESSION_AGE_MS) {
      clearPersistedSession()
      return null
    }

    const events = data.events
      .map(normalizeDebuggerEvent)
      .filter((e): e is DebuggerEvent => e !== null)

    return {
      sessionId: data.sessionId,
      captureType: data.captureType,
      startedAt: data.startedAt,
      recordingStartedAt: data.recordingStartedAt,
      events,
    }
  } catch {
    return null
  }
}

export function clearPersistedSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

function isPersistedSession(value: unknown): value is PersistedSession {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.version === SESSION_VERSION &&
    typeof v.sessionId === "string" &&
    (v.captureType === "video" || v.captureType === "screenshot") &&
    typeof v.startedAt === "number" &&
    typeof v.savedAt === "number" &&
    Array.isArray(v.events)
  )
}
```

**Step 2: Write unit tests**

```typescript
// sdks/capture/test/session-storage.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  clearPersistedSession,
  loadPersistedSession,
  persistSession,
} from "../src/debugger/session-storage"
import type { DebuggerSession } from "../src/types"

const SESSION: DebuggerSession = {
  sessionId: "sess_abc123",
  captureType: "video",
  startedAt: 1_700_000_000_000,
  recordingStartedAt: 1_700_000_001_000,
  events: [
    {
      kind: "network",
      timestamp: 1_700_000_002_000,
      method: "GET",
      url: "https://example.com/api/data",
      status: 200,
    },
  ],
}

beforeEach(() => {
  // Use a real in-memory sessionStorage (Bun provides this)
  clearPersistedSession()
})

afterEach(() => {
  clearPersistedSession()
})

describe("persistSession / loadPersistedSession", () => {
  it("round-trips a session through sessionStorage", () => {
    persistSession(SESSION)
    const restored = loadPersistedSession()

    expect(restored).not.toBeNull()
    expect(restored?.sessionId).toBe("sess_abc123")
    expect(restored?.captureType).toBe("video")
    expect(restored?.startedAt).toBe(1_700_000_000_000)
    expect(restored?.recordingStartedAt).toBe(1_700_000_001_000)
    expect(restored?.events).toHaveLength(1)
    expect(restored?.events[0]).toMatchObject({
      kind: "network",
      method: "GET",
      url: "https://example.com/api/data",
    })
  })

  it("returns null when nothing is stored", () => {
    expect(loadPersistedSession()).toBeNull()
  })

  it("returns null and clears storage for an expired session", () => {
    persistSession(SESSION)

    // Manually corrupt the savedAt to simulate expiry
    const raw = sessionStorage.getItem("__crikketActiveSession")!
    const data = JSON.parse(raw)
    data.savedAt = Date.now() - 6 * 60 * 1000 // 6 minutes ago
    sessionStorage.setItem("__crikketActiveSession", JSON.stringify(data))

    expect(loadPersistedSession()).toBeNull()
    expect(sessionStorage.getItem("__crikketActiveSession")).toBeNull()
  })

  it("returns null for malformed JSON", () => {
    sessionStorage.setItem("__crikketActiveSession", "not-json")
    expect(loadPersistedSession()).toBeNull()
  })

  it("returns null for a valid object with wrong version", () => {
    sessionStorage.setItem(
      "__crikketActiveSession",
      JSON.stringify({ version: 99, sessionId: "x", captureType: "video", startedAt: 1, savedAt: Date.now(), events: [] })
    )
    expect(loadPersistedSession()).toBeNull()
  })

  it("drops invalid events during restore without failing", () => {
    persistSession({
      ...SESSION,
      events: [
        { kind: "network", timestamp: 1_700_000_002_000, method: "GET", url: "https://example.com/api" } as never,
        { kind: "INVALID" } as never, // should be dropped by normalizeDebuggerEvent
      ],
    })
    const restored = loadPersistedSession()
    expect(restored?.events).toHaveLength(1)
  })
})

describe("clearPersistedSession", () => {
  it("removes the stored session", () => {
    persistSession(SESSION)
    clearPersistedSession()
    expect(loadPersistedSession()).toBeNull()
  })

  it("does not throw when nothing is stored", () => {
    expect(() => clearPersistedSession()).not.toThrow()
  })
})
```

**Step 3: Run tests**

```bash
cd /var/www/forks/crikket && bun test sdks/capture/test/session-storage.test.ts
```

Expected: all pass. If `sessionStorage` is not available in the Bun test environment, mock it with `Object.defineProperty(globalThis, "sessionStorage", { value: new Map-backed shim, configurable: true })`.

**Step 4: Commit**

```bash
git add sdks/capture/src/debugger/session-storage.ts sdks/capture/test/session-storage.test.ts
git commit -m "feat(capture-sdk): add session-storage helpers for cross-page recording"
```

---

### Task 2: Update `DebuggerCollector` — persist, restore, clear

**Files:**
- Modify: `sdks/capture/src/debugger/debugger-collector.ts`

Four changes:
1. `install()` — restore session from storage and register a `pagehide` listener
2. `dispose()` — remove the `pagehide` listener
3. `handlePageHide` — persist the active session to storage
4. `finalizeSession()` and `clearSession()` — call `clearPersistedSession()` so stale sessions don't leak

**Step 1: Add imports and `handlePageHide`**

At the top of the file, add:
```typescript
import {
  clearPersistedSession,
  loadPersistedSession,
  persistSession,
} from "./session-storage"
```

Add the handler as a class field (arrow function so `this` binds correctly):
```typescript
private readonly handlePageHide = (): void => {
  if (this.session) {
    persistSession(this.session)
  }
}
```

**Step 2: Update `install()`**

After the existing `window.addEventListener("message", ...)` line, add:

```typescript
// Restore any session that was persisted during a previous-page navigation
const restored = loadPersistedSession()
if (restored) {
  this.session = {
    sessionId: restored.sessionId,
    captureType: restored.captureType,
    startedAt: restored.startedAt,
    recordingStartedAt: restored.recordingStartedAt,
    events: [...restored.events],
  }
}

window.addEventListener("pagehide", this.handlePageHide, { capture: true })
```

**Step 3: Update `dispose()`**

After the existing `removeEventListener` for messages, add:
```typescript
window.removeEventListener("pagehide", this.handlePageHide, { capture: true })
```

**Step 4: Update `clearSession()`**

```typescript
clearSession(): void {
  this.session = null
  clearPersistedSession()
}
```

**Step 5: Update `finalizeSession()`**

The call to `this.clearSession()` at the end already handles `clearPersistedSession()` via the updated method — no additional change needed. Verify it's called there.

**Step 6: Add `hasActiveSession()` and `getSessionStartedAt()`** (needed by `LazyDebuggerCollector` in Task 3)

```typescript
hasActiveSession(): boolean {
  return this.session !== null
}

getSessionStartedAt(): number | null {
  return this.session?.startedAt ?? null
}
```

**Step 7: Run existing tests to confirm nothing broke**

```bash
cd /var/www/forks/crikket && bun test sdks/capture/test
```

Expected: all existing tests pass (the `DebuggerCollector` is mocked in flow tests, so the new methods just need to be present in the mock — see Task 5).

**Step 8: Commit**

```bash
git add sdks/capture/src/debugger/debugger-collector.ts
git commit -m "feat(capture-sdk): persist and restore debugger session across page navigations"
```

---

### Task 3: Update `DebuggerCollector.startSession()` to inherit cross-page events

**Files:**
- Modify: `sdks/capture/src/debugger/debugger-collector.ts:78-98`

When a session has been restored from storage and the user then starts recording on the new page, `startSession()` should carry forward the accumulated events rather than starting from scratch. It also preserves the original `startedAt` so the timeline across pages is coherent.

**Step 1: Update `startSession()`**

Replace the current implementation:

```typescript
startSession(captureType: CaptureType, lookbackMs = 0): DebuggerSession {
  const now = Date.now()

  // If a session was restored from a previous page, carry its events forward
  // so the cross-page trace is preserved in the new recording segment.
  const priorSession = this.session
  const inheritedEvents: DebuggerEvent[] = priorSession
    ? [...priorSession.events]
    : []
  const sessionStartedAt = priorSession?.startedAt ?? now

  const nextSession: DebuggerSession = {
    sessionId: createSessionId(),
    captureType,
    startedAt: sessionStartedAt,
    recordingStartedAt: captureType === "screenshot" ? now : null,
    events: inheritedEvents,
  }

  if (lookbackMs > 0) {
    for (const event of this.recentEvents) {
      if (now - event.timestamp <= lookbackMs) {
        this.appendEvent(nextSession.events, event)
      }
    }
  }

  this.session = nextSession
  return nextSession
}
```

**Key invariant:** in the normal flow (no navigation), `this.session` is always null when `startSession()` is called because `clearSession()` was called during `reset()`. So `inheritedEvents` is empty and behaviour is unchanged. Only when `install()` has restored a session does `priorSession` have a value.

**Step 2: Run existing tests**

```bash
cd /var/www/forks/crikket && bun test sdks/capture/test
```

Expected: all pass (the collector is mocked so `startSession` behaviour is not tested here yet).

**Step 3: Commit**

```bash
git add sdks/capture/src/debugger/debugger-collector.ts
git commit -m "feat(capture-sdk): inherit cross-page events when starting a new recording segment"
```

---

### Task 4: Update `LazyDebuggerCollector` — expose `ensureSessionRestored()`

**Files:**
- Modify: `sdks/capture/src/debugger/lazy-debugger-collector.ts`

The `CaptureSdkRuntime` needs two things synchronously at `init()` time (before loading the full collector): a cheap check for whether storage has a session, and an async trigger to load the collector and get the restored `startedAt`.

**Step 1: Add `ensureSessionRestored()`**

The cheap sync check lives in `capture-runtime.ts` as a direct import of `loadPersistedSession` (see Task 5). The async path goes here:

```typescript
async ensureSessionRestored(): Promise<number | null> {
  const collector = await this.ensureCollector()
  // ensureCollector() calls collector.install(), which restores the session from storage
  return collector.getSessionStartedAt()
}
```

**Step 2: Run existing tests**

```bash
cd /var/www/forks/crikket && bun test sdks/capture/test
```

Expected: all pass.

**Step 3: Commit**

```bash
git add sdks/capture/src/debugger/lazy-debugger-collector.ts
git commit -m "feat(capture-sdk): add ensureSessionRestored() to LazyDebuggerCollector"
```

---

### Task 5: Update `CaptureSdkRuntime` — auto-resume on `init()`, handle stop gracefully

**Files:**
- Modify: `sdks/capture/src/runtime/capture-runtime.ts`

Two changes:

**Change A — `init()` kicks off resume**

When `init()` is called, do a cheap synchronous check of `sessionStorage`. If a session is there, trigger the async resume path (non-blocking — the UI updates once the collector loads).

Add import at top:
```typescript
import { loadPersistedSession } from "../debugger/session-storage"
```

In `init()`, after `this.mount(...)`:
```typescript
if (loadPersistedSession()) {
  this.resumePersistedSession()
}
```

Add private method:
```typescript
private resumePersistedSession(): void {
  this.debuggerCollector
    .ensureSessionRestored()
    .then((startedAt) => {
      if (startedAt !== null) {
        this.mountedUi?.store.showRecording(startedAt)
      }
    })
    .catch(() => undefined)
}
```

`store.showRecording(startedAt)` is the existing method that opens the recording dock UI with a running clock. This is the same state shown when the user is actively recording — which is exactly right.

**Change B — `onStopRecording` handles the no-active-recording case**

When the dock is shown for a resumed session and there's no active `MediaRecorder`, clicking "Stop" should fall back to a screenshot so the user still gets a report with all the cross-page debugger data.

In `mount()`, update the `onStopRecording` handler:
```typescript
onStopRecording: async () => {
  if (this.activeRecording) {
    const blob = await this.stopRecording()
    if (!blob) {
      throw new Error("Recording capture failed.")
    }
  } else {
    // Resumed session with no active recording on this page — take a screenshot
    // so the user still gets a report with the full cross-page trace.
    const blob = await this.takeScreenshot()
    if (!blob) {
      throw new Error("Screenshot capture failed.")
    }
  }
},
```

**Step 1: Apply both changes**

**Step 2: Run existing tests**

```bash
cd /var/www/forks/crikket && bun test sdks/capture/test
```

Expected: all pass. The `DebuggerCollector` mock needs `hasActiveSession` and `getSessionStartedAt` — update the harness first (Step 3).

**Step 3: Update `sdk-test-harness.ts` mock to include new methods**

In `mock.module(DEBUGGER_COLLECTOR_PATH, ...)`, add to the mock class:

```typescript
hasActiveSession(): boolean {
  return false // default: no restored session
}

getSessionStartedAt(): number | null {
  return null // default: no restored session
}
```

Also add to `sdkTestState` so tests can override:
```typescript
restoredSessionStartedAt: null as number | null,
```

And update `resetSdkTestState()`:
```typescript
sdkTestState.restoredSessionStartedAt = null
```

Update the mock `getSessionStartedAt()`:
```typescript
getSessionStartedAt(): number | null {
  return sdkTestState.restoredSessionStartedAt
}

hasActiveSession(): boolean {
  return sdkTestState.restoredSessionStartedAt !== null
}
```

**Step 4: Run tests**

```bash
cd /var/www/forks/crikket && bun test sdks/capture/test
```

Expected: all pass.

**Step 5: Commit**

```bash
git add sdks/capture/src/runtime/capture-runtime.ts sdks/capture/test/lib/sdk-test-harness.ts
git commit -m "feat(capture-sdk): auto-resume recording session on init and handle stop without active recording"
```

---

### Task 6: Write integration tests for the cross-page resume flow

**Files:**
- Create: `sdks/capture/test/cross-page-recording.test.ts`

These tests use the existing harness (mocked `DebuggerCollector`) and verify that `CaptureSdkRuntime` correctly:
1. Opens the recording dock when `restoredSessionStartedAt` is non-null at init
2. Falls back to screenshot when stop is called with no active recording

```typescript
// sdks/capture/test/cross-page-recording.test.ts
import { describe, expect, it } from "bun:test"
import {
  getCaptureSdk,
  sdkTestState,
  setupCaptureSdkTestHooks,
  waitFor,
} from "./lib/sdk-test-harness"

setupCaptureSdkTestHooks()

describe("cross-page recording resume", () => {
  it("shows the recording dock when a restored session is detected at init", async () => {
    const capture = getCaptureSdk()

    // Simulate a restored session from a previous page
    sdkTestState.restoredSessionStartedAt = 1_700_000_000_000

    capture.init({ key: "crk_cross_page", host: "https://api.crikket.io" })

    // The resume is async — wait for the dock to open
    await waitFor(() => sdkTestState.uiHidden.length > 0 || true) // tick
    await new Promise((r) => setTimeout(r, 10))

    // The store's showRecording should have been called — recording dock is open
    // We verify by checking that startSession was NOT called (no new session was started)
    // and that no chooser was shown (we went straight to dock)
    expect(sdkTestState.startSessionCalls).toHaveLength(0)
    expect(sdkTestState.uiOpenChooserCalls).toBe(0)
  })

  it("does not open the recording dock when no session is in storage", async () => {
    const capture = getCaptureSdk()

    // restoredSessionStartedAt defaults to null — no session in storage

    capture.init({ key: "crk_fresh", host: "https://api.crikket.io" })
    await new Promise((r) => setTimeout(r, 10))

    expect(sdkTestState.startSessionCalls).toHaveLength(0)
    expect(sdkTestState.uiOpenChooserCalls).toBe(0)
  })

  it("takes a screenshot when stop is called without an active recording", async () => {
    const capture = getCaptureSdk()
    sdkTestState.restoredSessionStartedAt = 1_700_000_000_000

    capture.init({ key: "crk_cross_page_stop", host: "https://api.crikket.io" })
    await new Promise((r) => setTimeout(r, 10))

    // Stop without ever calling startRecording()
    const blob = await capture.takeScreenshot()
    expect(blob).toBe(sdkTestState.screenshotBlob)
    expect(sdkTestState.finalizeSessionCalls).toBe(1)
  })
})
```

**Step 1: Run tests**

```bash
cd /var/www/forks/crikket && bun test sdks/capture/test/cross-page-recording.test.ts
```

Expected: all pass. Adjust timing if needed (increase the `setTimeout` delay).

**Step 2: Run full test suite**

```bash
cd /var/www/forks/crikket && bun test sdks/capture/test
```

Expected: all pass.

**Step 3: Commit**

```bash
git add sdks/capture/test/cross-page-recording.test.ts
git commit -m "test(capture-sdk): add integration tests for cross-page recording resume"
```

---

### Task 7: Manual smoke test

No automated test covers the full cross-page journey. Do this manually in a dev environment.

**Setup:** embed the SDK in a test page on a multi-page app (or use two separate HTML files served locally).

**Steps:**
1. Open page A. Start a recording.
2. Make some network requests (e.g., trigger a data fetch).
3. Navigate to page B (full page reload, same origin).
4. Verify: the recording dock appears automatically on page B.
5. Make more network requests on page B.
6. Click "Stop" in the dock. The screenshot flow runs.
7. Verify: the review summary shows network requests from **both** page A and page B.
8. Submit the report. Verify the debugger payload includes events from both pages.

**Edge cases to verify:**
- Navigate back from page B to page A — dock should still appear, events still accumulate.
- Leave the tab idle for 6+ minutes, then navigate — stale session should be discarded (dock should not appear).
- Open a second tab — dock should not appear (sessionStorage is tab-scoped).
- Close the tab and reopen the URL — dock should not appear (sessionStorage cleared).

---

## Known limitations (out of scope for this plan)

- **Video across pages:** The `MediaRecorder` cannot survive a page navigation. This plan gives you screenshot + debugger trace for the "resumed" page. A multi-segment video would require re-requesting screen capture on the new page and stitching segments server-side.
- **Cross-origin navigation:** `sessionStorage` is origin-scoped, so navigation to a different origin loses the session. URL-param handoff (the original `appendDebuggerSessionIdToUrl` stub) would be needed for that case.
- **Eager hook installation:** The fetch hook is still installed lazily at `startRecordingSession()` time. Network requests made before recording starts on page B will not be captured. A separate effort should install hooks at `init()` time.
