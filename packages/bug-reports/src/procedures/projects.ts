import { ORPCError } from "@orpc/server"
import { z } from "zod"
import {
  createProject,
  deleteProject,
  getProjectById,
  listProjects,
  updateProject,
} from "../lib/project"
import { protectedProcedure } from "./context"
import { requireActiveOrgAdmin, requireActiveOrgId } from "./helpers"

const projectIdSchema = z.object({ id: z.string().min(1) })

const createProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
})

const updateProjectInputSchema = projectIdSchema.extend({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
})

function rethrowProjectError(error: unknown): never {
  if (error instanceof ORPCError) throw error
  const message = error instanceof Error ? error.message : null
  if (message) throw new ORPCError("BAD_REQUEST", { message })
  throw new ORPCError("INTERNAL_SERVER_ERROR", {
    message: "Failed to process project request.",
  })
}

export const listProjectsProcedure = protectedProcedure.handler(
  async ({ context }) => {
    const organizationId = requireActiveOrgId(context.session)
    return listProjects({ organizationId })
  }
)

export const createProjectProcedure = protectedProcedure
  .input(createProjectInputSchema)
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)
    try {
      return await createProject({
        organizationId,
        name: input.name,
        slug: input.slug,
        description: input.description,
      })
    } catch (error) {
      rethrowProjectError(error)
    }
  })

export const updateProjectProcedure = protectedProcedure
  .input(updateProjectInputSchema)
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)
    const existing = await getProjectById({ id: input.id, organizationId })
    if (!existing) throw new ORPCError("NOT_FOUND", { message: "Project not found." })
    try {
      return await updateProject({
        id: input.id,
        organizationId,
        name: input.name,
        description: input.description,
      })
    } catch (error) {
      rethrowProjectError(error)
    }
  })

export const deleteProjectProcedure = protectedProcedure
  .input(projectIdSchema)
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)
    const existing = await getProjectById({ id: input.id, organizationId })
    if (!existing) throw new ORPCError("NOT_FOUND", { message: "Project not found." })
    await deleteProject({ id: input.id, organizationId })
  })
