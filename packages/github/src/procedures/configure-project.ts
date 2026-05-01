import { getProjectById } from "@crikket/bug-reports/lib/project"
import { ORPCError } from "@orpc/server"
import { z } from "zod"
import {
  deleteProjectGithubConfig,
  upsertProjectGithubConfig,
} from "../service/project-config"
import { protectedProcedure } from "./context"
import { requireActiveOrgAdmin } from "./helpers"

export const configureProjectGithub = protectedProcedure
  .input(
    z.object({
      projectId: z.string().min(1),
      installationId: z.string().min(1),
      repo: z.string().min(1),
      autoSync: z.boolean().optional(),
    })
  )
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)
    try {
      const project = await getProjectById({
        id: input.projectId,
        organizationId,
      })
      if (!project) {
        throw new ORPCError("NOT_FOUND", { message: "Project not found." })
      }
      return await upsertProjectGithubConfig({
        projectId: input.projectId,
        organizationId,
        installationId: input.installationId,
        repo: input.repo,
        autoSync: input.autoSync,
      })
    } catch (error) {
      if (error instanceof ORPCError) throw error
      throw new ORPCError("BAD_REQUEST", {
        message:
          error instanceof Error
            ? error.message
            : "Failed to configure project GitHub integration",
      })
    }
  })

export const deleteProjectGithubConfigProcedure = protectedProcedure
  .input(z.object({ projectId: z.string().min(1) }))
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)
    await deleteProjectGithubConfig({
      projectId: input.projectId,
      organizationId,
    })
  })
