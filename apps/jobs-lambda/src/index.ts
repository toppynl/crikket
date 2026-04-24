import {
  runArtifactCleanupPass,
  runBugReportIngestionPass,
  runStalePendingBugReportCleanupPass,
} from "@crikket/jobs"
import type { EventBridgeEvent } from "aws-lambda"

type JobName = "artifact-cleanup" | "ingestion" | "orphan-cleanup"

export async function handler(
  event: EventBridgeEvent<"Scheduled Event", { job: JobName }>
): Promise<void> {
  const job = event.detail?.job

  switch (job) {
    case "artifact-cleanup":
      await runArtifactCleanupPass({ limit: 50 })
      break
    case "ingestion":
      await runBugReportIngestionPass({ limit: 10 })
      break
    case "orphan-cleanup":
      await runStalePendingBugReportCleanupPass({ limit: 10 })
      break
    default:
      throw new Error(`Unknown job: ${String(job)}`)
  }
}
