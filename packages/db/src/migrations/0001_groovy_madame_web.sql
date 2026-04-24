CREATE TABLE "github_capture_key_override" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_key_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_capture_key_override_capture_key_id_unique" UNIQUE("capture_key_id")
);
--> statement-breakpoint
CREATE TABLE "github_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"default_owner" text NOT NULL,
	"default_repo" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_integration_org_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "github_issue_link" (
	"id" text PRIMARY KEY NOT NULL,
	"bug_report_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"issue_number" integer NOT NULL,
	"issue_url" text NOT NULL,
	"pushed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"github_delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"error_message" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_webhook_event_github_delivery_id_unique" UNIQUE("github_delivery_id")
);
--> statement-breakpoint
ALTER TABLE "github_capture_key_override" ADD CONSTRAINT "github_capture_key_override_capture_key_id_capture_public_key_id_fk" FOREIGN KEY ("capture_key_id") REFERENCES "public"."capture_public_key"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_capture_key_override" ADD CONSTRAINT "github_capture_key_override_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_integration" ADD CONSTRAINT "github_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issue_link" ADD CONSTRAINT "github_issue_link_bug_report_id_bug_report_id_fk" FOREIGN KEY ("bug_report_id") REFERENCES "public"."bug_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issue_link" ADD CONSTRAINT "github_issue_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_capture_key_override_org_idx" ON "github_capture_key_override" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "github_issue_link_bug_report_idx" ON "github_issue_link" USING btree ("bug_report_id");--> statement-breakpoint
CREATE INDEX "github_issue_link_org_idx" ON "github_issue_link" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "github_webhook_event_status_idx" ON "github_webhook_event" USING btree ("status");--> statement-breakpoint
CREATE INDEX "github_webhook_event_type_idx" ON "github_webhook_event" USING btree ("event_type");