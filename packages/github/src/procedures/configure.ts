import { ORPCError } from "@orpc/server"
import { z } from "zod"
import { configureGitHubIntegration } from "../service/configure"
import { protectedProcedure } from "./context"
import { requireActiveOrgAdmin } from "./helpers"

export const configure = protectedProcedure
  .input(
    z.object({
      installationId: z.string(),
      defaultRepo: z.string().min(1),
    })
  )
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)

    try {
      await configureGitHubIntegration(
        organizationId,
        input.installationId,
        input.defaultRepo
      )
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error
            ? error.message
            : "Failed to configure GitHub integration",
      })
    }
  })
