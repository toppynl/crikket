import { ORPCError } from "@orpc/server"
import { z } from "zod"
import {
  assignCaptureKeyToProject,
  createCapturePublicKey,
  deleteCapturePublicKey,
  listCapturePublicKeys,
  revokeCapturePublicKey,
  rotateCapturePublicKey,
  updateCapturePublicKeyDetails,
  updateCapturePublicKeyOrigins,
} from "../lib/capture-public-key"
import { protectedProcedure } from "./context"
import { requireActiveOrgAdmin } from "./helpers"

const captureKeyIdSchema = z.object({
  keyId: z.string().min(1),
})

const captureKeyOriginsSchema = z
  .array(z.string().trim().min(1).max(200))
  .min(1, "At least one allowed origin is required.")
  .max(20, "At most 20 allowed origins are allowed.")

const createCaptureKeyInputSchema = z.object({
  label: z.string().trim().min(1).max(80),
  allowedOrigins: captureKeyOriginsSchema,
})

const updateCaptureKeyOriginsInputSchema = captureKeyIdSchema.extend({
  allowedOrigins: captureKeyOriginsSchema,
})

const updateCaptureKeyDetailsInputSchema = captureKeyIdSchema.extend({
  allowedOrigins: captureKeyOriginsSchema,
  label: z.string().trim().min(1).max(80),
})

function rethrowCaptureKeyInputError(error: unknown): never {
  if (error instanceof ORPCError) {
    throw error
  }

  const message = error instanceof Error ? error.message : null
  if (message) {
    throw new ORPCError("BAD_REQUEST", { message })
  }

  throw new ORPCError("INTERNAL_SERVER_ERROR", {
    message: "Failed to process capture key request.",
  })
}

export const listCaptureKeys = protectedProcedure.handler(
  async ({ context }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)

    return listCapturePublicKeys({
      organizationId,
    })
  }
)

export const createCaptureKey = protectedProcedure
  .input(createCaptureKeyInputSchema)
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)

    try {
      return await createCapturePublicKey({
        allowedOrigins: input.allowedOrigins,
        createdBy: context.session.user.id,
        label: input.label,
        organizationId,
      })
    } catch (error) {
      rethrowCaptureKeyInputError(error)
    }
  })

export const updateCaptureKeyOrigins = protectedProcedure
  .input(updateCaptureKeyOriginsInputSchema)
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)

    try {
      return await updateCapturePublicKeyOrigins({
        allowedOrigins: input.allowedOrigins,
        keyId: input.keyId,
        organizationId,
      })
    } catch (error) {
      rethrowCaptureKeyInputError(error)
    }
  })

export const updateCaptureKeyDetails = protectedProcedure
  .input(updateCaptureKeyDetailsInputSchema)
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)

    try {
      return await updateCapturePublicKeyDetails({
        allowedOrigins: input.allowedOrigins,
        keyId: input.keyId,
        label: input.label,
        organizationId,
      })
    } catch (error) {
      rethrowCaptureKeyInputError(error)
    }
  })

export const revokeCaptureKey = protectedProcedure
  .input(captureKeyIdSchema)
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)

    return revokeCapturePublicKey({
      keyId: input.keyId,
      organizationId,
    })
  })

export const deleteCaptureKey = protectedProcedure
  .input(captureKeyIdSchema)
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)

    return deleteCapturePublicKey({
      keyId: input.keyId,
      organizationId,
    })
  })

export const rotateCaptureKey = protectedProcedure
  .input(captureKeyIdSchema)
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)

    return rotateCapturePublicKey({
      keyId: input.keyId,
      organizationId,
    })
  })

export const assignCaptureKeyToProjectProcedure = protectedProcedure
  .input(
    z.object({
      keyId: z.string().min(1),
      projectId: z.string().nullable(),
    })
  )
  .handler(async ({ context, input }) => {
    const organizationId = await requireActiveOrgAdmin(context.session)
    return assignCaptureKeyToProject({
      keyId: input.keyId,
      organizationId,
      projectId: input.projectId,
    })
  })
