import { initDb } from "@crikket/db"
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
    initDb(env.DB.connectionString)
    return app.fetch(request, env, ctx)
  },
}
