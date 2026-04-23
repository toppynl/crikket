import { db } from "@crikket/db"
import { githubWebhookEvent } from "@crikket/db/schema/github"
import { eq } from "drizzle-orm"
import { processIssuesClosed } from "./processors/issues-closed"
import { processIssuesReopened } from "./processors/issues-reopened"

async function claimNextEvent() {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(githubWebhookEvent)
      .where(eq(githubWebhookEvent.status, "received"))
      .limit(1)
      .for("update", { skipLocked: true })

    if (!event) return null

    await tx
      .update(githubWebhookEvent)
      .set({ status: "processing" })
      .where(eq(githubWebhookEvent.id, event.id))

    return event
  })
}

export async function runGitHubWebhookProcessorPass(
  options: { limit: number } = { limit: 10 }
): Promise<void> {
  for (let i = 0; i < options.limit; i++) {
    const event = await claimNextEvent()
    if (!event) break

    try {
      const payload = event.payload as Record<string, unknown>
      const action = (payload.action) as string | undefined

      if (event.eventType === "issues") {
        if (action === "closed") {
          await processIssuesClosed(payload as Parameters<typeof processIssuesClosed>[0])
        } else if (action === "reopened") {
          await processIssuesReopened(payload as Parameters<typeof processIssuesReopened>[0])
        }
      }

      await db
        .update(githubWebhookEvent)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(githubWebhookEvent.id, event.id))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await db
        .update(githubWebhookEvent)
        .set({
          status: "failed",
          errorMessage: message.slice(0, 2000),
          attemptCount: event.attemptCount + 1,
        })
        .where(eq(githubWebhookEvent.id, event.id))
    }
  }
}
