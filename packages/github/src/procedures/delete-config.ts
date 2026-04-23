import { ORPCError } from "@orpc/server"
import { z } from "zod"
import { deleteGitHubIntegration } from "../service/configure"
import { protectedProcedure } from "./context"

export const deleteConfig = protectedProcedure
  .input(z.object({}).optional())
  .handler(async ({ context }) => {
    const organizationId = context.session.session.activeOrganizationId
    if (!organizationId) {
      throw new ORPCError("UNAUTHORIZED", { message: "No active organization" })
    }
    await deleteGitHubIntegration(organizationId)
  })
