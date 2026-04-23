import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core"
import { organization } from "./auth"
import { bugReport, capturePublicKey } from "./bug-report"

export const githubIntegration = pgTable(
  "github_integration",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    installationId: text("installation_id").notNull(),
    defaultOwner: text("default_owner").notNull(),
    defaultRepo: text("default_repo").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [unique("github_integration_org_unique").on(table.organizationId)]
)

export const githubCaptureKeyOverride = pgTable(
  "github_capture_key_override",
  {
    id: text("id").primaryKey(),
    captureKeyId: text("capture_key_id")
      .notNull()
      .unique()
      .references(() => capturePublicKey.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("github_capture_key_override_org_idx").on(table.organizationId),
  ]
)

export const githubIssueLink = pgTable(
  "github_issue_link",
  {
    id: text("id").primaryKey(),
    bugReportId: text("bug_report_id")
      .notNull()
      .references(() => bugReport.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    issueNumber: integer("issue_number").notNull(),
    issueUrl: text("issue_url").notNull(),
    pushedAt: timestamp("pushed_at").defaultNow().notNull(),
  },
  (table) => [
    index("github_issue_link_bug_report_idx").on(table.bugReportId),
    index("github_issue_link_org_idx").on(table.organizationId),
  ]
)

export const githubWebhookEvent = pgTable(
  "github_webhook_event",
  {
    id: text("id").primaryKey(),
    githubDeliveryId: text("github_delivery_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    status: text("status").default("received").notNull(),
    payload: jsonb("payload").notNull(),
    attemptCount: integer("attempt_count").default(1).notNull(),
    errorMessage: text("error_message"),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("github_webhook_event_status_idx").on(table.status),
    index("github_webhook_event_type_idx").on(table.eventType),
  ]
)
