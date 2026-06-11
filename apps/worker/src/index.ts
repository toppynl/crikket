import { createDb, runWithDb } from "@crikket/db"
import { initServerEnv } from "@crikket/env/server"
import {
  runArtifactCleanupPass,
  runBugReportIngestionPass,
  runStalePendingBugReportCleanupPass,
} from "@crikket/jobs"

interface Env {
  DB: { connectionString: string }
  [key: string]: unknown
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    initServerEnv(env)

    // Scope the connection to this invocation so overlapping scheduled runs in
    // the same isolate don't share or close each other's connection.
    const { db, sql } = createDb(env.DB.connectionString)
    try {
      await runWithDb(db, async () => {
        switch (controller.cron) {
          case "*/5 * * * *":
            await runArtifactCleanupPass({ limit: 50 })
            break
          case "* * * * *":
            await runBugReportIngestionPass({ limit: 10 })
            break
          case "0 * * * *":
            await runStalePendingBugReportCleanupPass({ limit: 10 })
            break
          default:
            console.error(`[worker] unknown cron: ${controller.cron}`)
        }
      })
    } finally {
      ctx.waitUntil(sql.end({ timeout: 5 }).catch(() => undefined))
    }
  },
} satisfies ExportedHandler<Env>
