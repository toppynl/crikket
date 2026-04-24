import { initDb } from "@crikket/db"
import app from "./index"

interface Env {
  DB: Hyperdrive
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    initDb(env.DB.connectionString)
    return app.fetch(request, env, ctx)
  },
}
