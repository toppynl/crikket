CREATE TABLE "project_github_config" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"auto_sync" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_github_config_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_org_slug_unique" UNIQUE("organization_id","slug")
);
--> statement-breakpoint
ALTER TABLE "bug_report" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "bug_report_upload_session" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "capture_public_key" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "project_github_config" ADD CONSTRAINT "project_github_config_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_github_config" ADD CONSTRAINT "project_github_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_github_config_org_idx" ON "project_github_config" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_organizationId_idx" ON "project" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "bug_report" ADD CONSTRAINT "bug_report_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_report_upload_session" ADD CONSTRAINT "bug_report_upload_session_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capture_public_key" ADD CONSTRAINT "capture_public_key_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bug_report_projectId_idx" ON "bug_report" USING btree ("project_id");