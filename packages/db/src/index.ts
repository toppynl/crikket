import { AsyncLocalStorage } from "node:async_hooks"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"

import * as schema from "./schema"

export type Database = ReturnType<typeof drizzle<typeof schema>>
export type Sql = ReturnType<typeof postgres>

// `prepare: false` is required for Cloudflare Hyperdrive, which does not
// support prepared statements. It has negligible impact on regular Postgres.
// Returns the `sql` client alongside the drizzle instance so callers can close
// the underlying connection (required for per-request use on Workers).
export function createDb(connectionString: string): {
  db: Database
  sql: Sql
} {
  const sql = postgres(connectionString, { prepare: false })
  return { db: drizzle(sql, { schema }), sql }
}

// Per-request DB scope. A single Cloudflare Worker isolate serves many requests
// concurrently while sharing module globals, so a connection cannot live in a
// shared mutable global: one request would overwrite another's client and end
// up using a socket bound to a different request's I/O context, which the
// Workers runtime rejects (surfacing as "Failed query"). Running each request
// inside its own AsyncLocalStorage scope gives every request its own client.
const requestDbStorage = new AsyncLocalStorage<Database>()

// Run `fn` with a request-scoped database. The store propagates across awaits
// inside `fn`, so any `db` access during the request resolves to this client.
export function runWithDb<T>(database: Database, fn: () => T): T {
  return requestDbStorage.run(database, fn)
}

// Lazy-initialized singleton for long-lived single-process targets (Bun,
// Node.js, Lambda, Cloud Run) where one process owns one connection.
let _db: Database | undefined

// For traditional single-process targets: call initDb(connectionString) once at
// startup, or rely on the lazy DATABASE_URL fallback in the proxy below.
export function initDb(connectionString: string): void {
  _db = createDb(connectionString).db
}

export const db: Database = new Proxy({} as Database, {
  get(_, prop) {
    // A request-scoped client always wins, so concurrent Worker requests never
    // share a connection.
    const scoped = requestDbStorage.getStore()
    if (scoped) {
      return Reflect.get(scoped, prop, scoped)
    }

    if (!_db) {
      const url =
        typeof process !== "undefined" ? process.env?.DATABASE_URL : undefined
      if (!url) {
        throw new Error(
          "DB not initialized. Call initDb() or set DATABASE_URL."
        )
      }
      _db = createDb(url).db
    }
    return Reflect.get(_db, prop, _db)
  },
})
