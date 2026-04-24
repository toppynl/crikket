import {
  runArtifactCleanupPass,
  runBugReportIngestionPass,
  runStalePendingBugReportCleanupPass,
} from "@crikket/jobs"

const job = process.env.JOB

async function main(): Promise<void> {
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
      throw new Error(`Unknown JOB env var: ${String(job)}`)
  }

  console.log(`[jobs-cloudrun] ${job} completed`)
}

main().catch((error) => {
  console.error("[jobs-cloudrun] job failed", error)
  process.exit(1)
})
