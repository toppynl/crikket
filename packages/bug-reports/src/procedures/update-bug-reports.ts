import { db } from "@crikket/db"
import { bugReport } from "@crikket/db/schema/bug-report"
import {
  PRIORITY_OPTIONS,
  type Priority,
} from "@crikket/shared/constants/priorities"
import { MAX_TAGS_PER_REPORT } from "@crikket/shared/constants/tag"
import { ORPCError } from "@orpc/server"
import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import {
  getTagsForBugReport,
  setBugReportTags,
  setBugReportTagsForMany,
} from "../lib/tag"
import {
  isStatus,
  isVisibility,
  optionalText,
  statusValues,
  visibilityValues,
} from "../lib/utils"
import { protectedProcedure } from "./context"
import { requireActiveOrgId } from "./helpers"

const priorityValues = Object.values(PRIORITY_OPTIONS) as [
  Priority,
  ...Priority[],
]

const tagIdsInputSchema = z.array(z.string().min(1)).max(MAX_TAGS_PER_REPORT)

const bugReportUpdateInputSchema = z
  .object({
    id: z.string().min(1),
    title: optionalText(200),
    status: z.enum(statusValues).optional(),
    priority: z.enum(priorityValues).optional(),
    visibility: z.enum(visibilityValues).optional(),
    tagIds: tagIdsInputSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.title === undefined &&
      value.status === undefined &&
      value.priority === undefined &&
      value.visibility === undefined &&
      value.tagIds === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one update field is required",
      })
    }
  })

const bugReportBulkUpdateInputSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(200),
    status: z.enum(statusValues).optional(),
    priority: z.enum(priorityValues).optional(),
    visibility: z.enum(visibilityValues).optional(),
    tagIds: tagIdsInputSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.status === undefined &&
      value.priority === undefined &&
      value.visibility === undefined &&
      value.tagIds === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one update field is required",
      })
    }
  })

function buildScalarUpdateValues(input: {
  title?: string
  status?: (typeof statusValues)[number]
  priority?: Priority
  visibility?: (typeof visibilityValues)[number]
}) {
  const values: {
    title?: string
    status?: string
    priority?: string
    visibility?: string
  } = {}

  if (input.title !== undefined) {
    values.title = input.title
  }

  if (input.status !== undefined) {
    values.status = input.status
  }

  if (input.priority !== undefined) {
    values.priority = input.priority
  }

  if (input.visibility !== undefined) {
    values.visibility = input.visibility
  }

  return values
}

export const updateBugReport = protectedProcedure
  .input(bugReportUpdateInputSchema)
  .handler(async ({ context, input }) => {
    const activeOrgId = requireActiveOrgId(context.session)
    const values = buildScalarUpdateValues(input)

    const returningColumns = {
      id: bugReport.id,
      title: bugReport.title,
      status: bugReport.status,
      priority: bugReport.priority,
      visibility: bugReport.visibility,
    }

    let report:
      | {
          id: string
          title: string | null
          status: string
          priority: string
          visibility: string
        }
      | undefined

    if (Object.keys(values).length > 0) {
      const updated = await db
        .update(bugReport)
        .set(values)
        .where(
          and(
            eq(bugReport.id, input.id),
            eq(bugReport.organizationId, activeOrgId)
          )
        )
        .returning(returningColumns)
      report = updated[0]
    } else {
      report = await db.query.bugReport.findFirst({
        where: and(
          eq(bugReport.id, input.id),
          eq(bugReport.organizationId, activeOrgId)
        ),
        columns: {
          id: true,
          title: true,
          status: true,
          priority: true,
          visibility: true,
        },
      })
    }

    if (!report) {
      throw new ORPCError("NOT_FOUND", { message: "Bug report not found" })
    }

    if (input.tagIds !== undefined) {
      await setBugReportTags({
        bugReportId: input.id,
        organizationId: activeOrgId,
        tagIds: input.tagIds,
      })
    }

    const tags = await getTagsForBugReport(report.id)

    return {
      id: report.id,
      title: report.title,
      status: isStatus(report.status) ? report.status : statusValues[0],
      priority: priorityValues.includes(report.priority as Priority)
        ? (report.priority as Priority)
        : PRIORITY_OPTIONS.none,
      visibility: isVisibility(report.visibility)
        ? report.visibility
        : visibilityValues[1],
      tags: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
      })),
    }
  })

export const updateBugReportsBulk = protectedProcedure
  .input(bugReportBulkUpdateInputSchema)
  .handler(async ({ context, input }) => {
    const activeOrgId = requireActiveOrgId(context.session)
    const values = buildScalarUpdateValues(input)
    const uniqueIds = Array.from(new Set(input.ids))

    let updatedIds: string[]
    if (Object.keys(values).length > 0) {
      const updated = await db
        .update(bugReport)
        .set(values)
        .where(
          and(
            eq(bugReport.organizationId, activeOrgId),
            inArray(bugReport.id, uniqueIds)
          )
        )
        .returning({ id: bugReport.id })
      updatedIds = updated.map((row) => row.id)
    } else {
      const rows = await db.query.bugReport.findMany({
        where: and(
          eq(bugReport.organizationId, activeOrgId),
          inArray(bugReport.id, uniqueIds)
        ),
        columns: { id: true },
      })
      updatedIds = rows.map((row) => row.id)
    }

    if (input.tagIds !== undefined && updatedIds.length > 0) {
      await setBugReportTagsForMany({
        bugReportIds: updatedIds,
        organizationId: activeOrgId,
        tagIds: input.tagIds,
      })
    }

    return {
      updatedCount: updatedIds.length,
      ids: updatedIds,
    }
  })

export const updateBugReportVisibility = protectedProcedure
  .input(
    z.object({
      id: z.string().min(1),
      visibility: z.enum(visibilityValues),
    })
  )
  .handler(async ({ context, input }) => {
    const activeOrgId = requireActiveOrgId(context.session)

    const updated = await db
      .update(bugReport)
      .set({ visibility: input.visibility })
      .where(
        and(
          eq(bugReport.id, input.id),
          eq(bugReport.organizationId, activeOrgId)
        )
      )
      .returning({ id: bugReport.id, visibility: bugReport.visibility })

    const report = updated[0]
    if (!report) {
      throw new ORPCError("NOT_FOUND", { message: "Bug report not found" })
    }

    return {
      id: report.id,
      visibility: isVisibility(report.visibility)
        ? report.visibility
        : visibilityValues[1],
    }
  })
