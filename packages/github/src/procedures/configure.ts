import { ORPCError } from "@orpc/server"
import { z } from "zod"
import { configureGitHubIntegration } from "../service/configure"
import { protectedProcedure } from "./context"

export const configure = protectedProcedure
  .input(
    z.object({
      installationId: z.string(),
      defaultRepo: z.string().min(1),
    })
  )
  .handler(async ({ context, input }) => {
    const organizationId = context.session.session.activeOrganizationId
    if (!organizationId) {
      throw new ORPCError("UNAUTHORIZED", { message: "No active organization" })
    }

    try {
      await configureGitHubIntegration(
        organizationId,
        input.installationId,
        input.defaultRepo
      )
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message: error instanceof Error ? error.message : "Failed to configure GitHub integration",
      })
    }
  })
