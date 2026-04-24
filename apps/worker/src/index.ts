import { initDb } from "@crikket/db"
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
    _ctx: ExecutionContext
  ): Promise<void> {
    initDb(env.DB.connectionString)

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
  },
} satisfies ExportedHandler<Env>
