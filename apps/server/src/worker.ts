import { createDb, runWithDb } from "@crikket/db"
import { initServerEnv } from "@crikket/env/server"
import app from "./index"

interface Env {
  DB: Hyperdrive
  [key: string]: unknown
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    initServerEnv(env)

    // A fresh connection per request: the Workers runtime forbids reusing a
    // socket across request contexts, and a shared module-global client would
    // be stomped by concurrent requests. Close it after the response is sent.
    const { db, sql } = createDb(env.DB.connectionString)
    try {
      return await runWithDb(db, () => app.fetch(request, env, ctx))
    } finally {
      ctx.waitUntil(sql.end({ timeout: 5 }).catch(() => undefined))
    }
  },
}
