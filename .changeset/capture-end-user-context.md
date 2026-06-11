---
"@crikket-io/capture": minor
---

Add end-user identity and freeform context to captures. `init()` (and the
`CapturePlugin` React component) now accept `user` (`{ id?, email?, name?, ... }`)
and `context` (an arbitrary `Record<string, unknown>`), and the runtime
controller exposes `setUser()` / `setContext()` to update them after init
without remounting the widget. Both are persisted alongside the report.
