import postgres from "postgres"
import { drizzle } from "drizzle-orm/postgres-js"

import * as schema from "./schema"

export type Database = ReturnType<typeof drizzle<typeof schema>>

// `prepare: false` is required for Cloudflare Hyperdrive, which does not
// support prepared statements. It has negligible impact on regular Postgres.
export function createDb(connectionString: string): Database {
  return drizzle(postgres(connectionString, { prepare: false }), { schema })
}

let _db: Database | undefined

// For Cloudflare Workers: call initDb(env.DB.connectionString) at the
// start of each fetch/scheduled handler before any db access.
export function initDb(connectionString: string): void {
  _db = createDb(connectionString)
}

// Lazy-initialized singleton for traditional targets (Bun, Node.js, Lambda,
// Cloud Run). Reads DATABASE_URL from process.env on first access.
export const db: Database = new Proxy({} as Database, {
  get(_, prop) {
    if (!_db) {
      const url =
        typeof process !== "undefined" ? process.env?.DATABASE_URL : undefined
      if (!url) {
        throw new Error(
          "DB not initialized. Call initDb() or set DATABASE_URL."
        )
      }
      _db = createDb(url)
    }
    return Reflect.get(_db, prop, _db)
  },
})
