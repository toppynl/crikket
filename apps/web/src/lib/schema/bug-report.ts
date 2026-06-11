import {
  BUG_REPORT_STATUS_OPTIONS,
  BUG_REPORT_VISIBILITY_OPTIONS,
} from "@crikket/shared/constants/bug-report"
import { PRIORITY_OPTIONS } from "@crikket/shared/constants/priorities"
import * as z from "zod"

const statusValues = Object.values(BUG_REPORT_STATUS_OPTIONS) as [
  (typeof BUG_REPORT_STATUS_OPTIONS)[keyof typeof BUG_REPORT_STATUS_OPTIONS],
  ...(typeof BUG_REPORT_STATUS_OPTIONS)[keyof typeof BUG_REPORT_STATUS_OPTIONS][],
]

const priorityValues = Object.values(PRIORITY_OPTIONS) as [
  (typeof PRIORITY_OPTIONS)[keyof typeof PRIORITY_OPTIONS],
  ...(typeof PRIORITY_OPTIONS)[keyof typeof PRIORITY_OPTIONS][],
]

const visibilityValues = Object.values(BUG_REPORT_VISIBILITY_OPTIONS) as [
  (typeof BUG_REPORT_VISIBILITY_OPTIONS)[keyof typeof BUG_REPORT_VISIBILITY_OPTIONS],
  ...(typeof BUG_REPORT_VISIBILITY_OPTIONS)[keyof typeof BUG_REPORT_VISIBILITY_OPTIONS][],
]

const MAX_TAGS = 20

export const editBugReportFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(200, "Name must be 200 characters or fewer"),
  tagIds: z
    .array(z.string().min(1))
    .max(MAX_TAGS, `Use ${MAX_TAGS} tags or fewer`),
  status: z.enum(statusValues),
  priority: z.enum(priorityValues),
  visibility: z.enum(visibilityValues),
})
