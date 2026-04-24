import { ORPCError } from "@orpc/server"
import { z } from "zod"
import { pushBugReportToGitHub } from "../service/push-issue"
import { protectedProcedure } from "./context"

export const pushIssue = protectedProcedure
  .input(z.object({ bugReportId: z.string() }))
  .handler(async ({ context, input }) => {
    const organizationId = context.session.session.activeOrganizationId
    if (!organizationId) {
      throw new ORPCError("UNAUTHORIZED", { message: "No active organization" })
    }

    try {
      return await pushBugReportToGitHub(input.bugReportId, organizationId)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error"
      if (message.includes("not configured")) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "GitHub integration not configured. Go to Settings → Integrations → GitHub.",
        })
      }
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message })
    }
  })
