import { relations } from "drizzle-orm"
import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core"
import { organization } from "./auth"

export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("project_organizationId_idx").on(table.organizationId),
    unique("project_org_slug_unique").on(table.organizationId, table.slug),
  ]
)

export const projectRelations = relations(project, ({ one }) => ({
  organization: one(organization, {
    fields: [project.organizationId],
    references: [organization.id],
  }),
}))
