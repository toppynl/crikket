import { z } from "zod"
import { getGitHubIntegration } from "../service/configure"
import { protectedProcedure } from "./context"

export const getConfig = protectedProcedure
  .input(z.object({}).optional())
  .handler(async ({ context }) => {
    const organizationId = context.session.session.activeOrganizationId
    if (!organizationId) return null
    return await getGitHubIntegration(organizationId)
  })
