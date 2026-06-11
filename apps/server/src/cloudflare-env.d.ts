// Minimal Cloudflare Workers globals referenced by `src/worker.ts`.
//
// We intentionally avoid pulling the full `wrangler types` runtime lib here:
// its workerd `lib` redefines DOM globals (URL, URLSearchParams, …) in a way
// that conflicts with the Node/Bun types used by the server's tests. Declaring
// only the handful of types this entrypoint needs keeps the global scope clean.

declare global {
  /** Cloudflare Hyperdrive binding (only the surface this app consumes). */
  interface Hyperdrive {
    readonly connectionString: string
  }

  /** Cloudflare Workers execution context passed to the fetch handler. */
  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void
    passThroughOnException(): void
    props: unknown
  }
}

export {}
