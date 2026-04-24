import { z } from "zod"
import { deleteGitHubIntegration } from "../service/configure"
import { protectedProcedure } from "./context"
import { requireActiveOrgAdmin } from "./helpers"

export const deleteConfig = protectedProcedure
  .input(z.object({}).optional())
  .handler(async ({ context }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)
    await deleteGitHubIntegration(organizationId)
  })
