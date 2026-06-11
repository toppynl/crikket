import { TAG_COLORS, type TagColor } from "@crikket/shared/constants/tag"
import { ORPCError } from "@orpc/server"
import { z } from "zod"
import {
  createTag,
  deleteTag,
  getTagById,
  listTags,
  updateTag,
} from "../lib/tag"
import { protectedProcedure } from "./context"
import { requireActiveOrgAdmin, requireActiveOrgId } from "./helpers"

const colorValues = TAG_COLORS as readonly [TagColor, ...TagColor[]]

const tagIdSchema = z.object({ id: z.string().min(1) })

const createTagInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(colorValues).optional(),
})

const updateTagInputSchema = tagIdSchema.extend({
  name: z.string().trim().min(1).max(40).optional(),
  color: z.enum(colorValues).optional(),
})

function rethrowTagError(error: unknown): never {
  if (error instanceof ORPCError) {
    throw error
  }
  const message = error instanceof Error ? error.message : null
  if (message) {
    throw new ORPCError("BAD_REQUEST", { message })
  }
  throw new ORPCError("INTERNAL_SERVER_ERROR", {
    message: "Failed to process tag request.",
  })
}

export const listTagsProcedure = protectedProcedure.handler(({ context }) => {
  const organizationId = requireActiveOrgId(context.session)
  return listTags({ organizationId })
})

export const createTagProcedure = protectedProcedure
  .input(createTagInputSchema)
  .handler(async ({ context, input }) => {
    const organizationId = requireActiveOrgId(context.session)
    try {
      return await createTag({
        organizationId,
        name: input.name,
        color: input.color,
      })
    } catch (error) {
      rethrowTagError(error)
    }
  })

export const updateTagProcedure = protectedProcedure
  .input(updateTagInputSchema)
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)
    const existing = await getTagById({ id: input.id, organizationId })
    if (!existing) {
      throw new ORPCError("NOT_FOUND", { message: "Tag not found." })
    }
    try {
      return await updateTag({
        id: input.id,
        organizationId,
        name: input.name,
        color: input.color,
      })
    } catch (error) {
      rethrowTagError(error)
    }
  })

export const deleteTagProcedure = protectedProcedure
  .input(tagIdSchema)
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)
    const existing = await getTagById({ id: input.id, organizationId })
    if (!existing) {
      throw new ORPCError("NOT_FOUND", { message: "Tag not found." })
    }
    await deleteTag({ id: input.id, organizationId })
  })
