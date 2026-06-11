import { relations } from "drizzle-orm"
import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core"
import { organization } from "./auth"
import { bugReport } from "./bug-report"

export const tag = pgTable(
  "tag",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    color: text("color").default("gray").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("tag_organizationId_idx").on(table.organizationId),
    unique("tag_org_slug_unique").on(table.organizationId, table.slug),
  ]
)

export const bugReportTag = pgTable(
  "bug_report_tag",
  {
    bugReportId: text("bug_report_id")
      .notNull()
      .references(() => bugReport.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bugReportId, table.tagId] }),
    index("bug_report_tag_tagId_idx").on(table.tagId),
  ]
)

export const tagRelations = relations(tag, ({ one, many }) => ({
  organization: one(organization, {
    fields: [tag.organizationId],
    references: [organization.id],
  }),
  bugReportTags: many(bugReportTag),
}))

export const bugReportTagRelations = relations(bugReportTag, ({ one }) => ({
  bugReport: one(bugReport, {
    fields: [bugReportTag.bugReportId],
    references: [bugReport.id],
  }),
  tag: one(tag, {
    fields: [bugReportTag.tagId],
    references: [tag.id],
  }),
}))
