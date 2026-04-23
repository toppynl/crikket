import { z } from "zod"
import { getProjectGithubConfig } from "../service/project-config"
import { protectedProcedure } from "./context"

export const getProjectGithubConfigProcedure = protectedProcedure
  .input(z.object({ projectId: z.string().min(1) }))
  .handler(async ({ context, input }) => {
    const organizationId = context.session.session.activeOrganizationId
    if (!organizationId) return null
    return await getProjectGithubConfig({
      projectId: input.projectId,
      organizationId,
    })
  })
