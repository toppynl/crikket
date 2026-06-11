ALTER TABLE "bug_report" ADD COLUMN "end_user" jsonb;--> statement-breakpoint
ALTER TABLE "bug_report" ADD COLUMN "context" jsonb;--> statement-breakpoint
ALTER TABLE "bug_report_upload_session" ADD COLUMN "end_user" jsonb;--> statement-breakpoint
ALTER TABLE "bug_report_upload_session" ADD COLUMN "context" jsonb;