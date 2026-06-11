CREATE TABLE "bug_report_tag" (
	"bug_report_id" text NOT NULL,
	"tag_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bug_report_tag_bug_report_id_tag_id_pk" PRIMARY KEY("bug_report_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tag_org_slug_unique" UNIQUE("organization_id","slug")
);
--> statement-breakpoint
ALTER TABLE "bug_report_tag" ADD CONSTRAINT "bug_report_tag_bug_report_id_bug_report_id_fk" FOREIGN KEY ("bug_report_id") REFERENCES "public"."bug_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_report_tag" ADD CONSTRAINT "bug_report_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bug_report_tag_tagId_idx" ON "bug_report_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tag_organizationId_idx" ON "tag" USING btree ("organization_id");--> statement-breakpoint
-- Backfill managed tags from existing free-text bug_report.tags arrays.
-- Slug normalization mirrors normalizeTagSlug() in @crikket/shared/constants/tag.
WITH exploded AS (
	SELECT
		br."id" AS bug_report_id,
		br."organization_id" AS organization_id,
		trim(t) AS name,
		substring(regexp_replace(regexp_replace(lower(trim(t)), '[^a-z0-9]+', '-', 'g'), '^-+|-+$', '', 'g') for 60) AS slug
	FROM "bug_report" br
	CROSS JOIN LATERAL unnest(coalesce(br."tags", ARRAY[]::text[])) AS t
)
INSERT INTO "tag" ("id", "organization_id", "name", "slug", "color", "created_at", "updated_at")
SELECT DISTINCT ON (organization_id, slug)
	md5(organization_id || ':' || slug), organization_id, name, slug, 'gray', now(), now()
FROM exploded
WHERE slug <> ''
ON CONFLICT ("organization_id", "slug") DO NOTHING;--> statement-breakpoint
WITH exploded AS (
	SELECT
		br."id" AS bug_report_id,
		br."organization_id" AS organization_id,
		substring(regexp_replace(regexp_replace(lower(trim(t)), '[^a-z0-9]+', '-', 'g'), '^-+|-+$', '', 'g') for 60) AS slug
	FROM "bug_report" br
	CROSS JOIN LATERAL unnest(coalesce(br."tags", ARRAY[]::text[])) AS t
)
INSERT INTO "bug_report_tag" ("bug_report_id", "tag_id", "created_at")
SELECT DISTINCT e.bug_report_id, tg."id", now()
FROM exploded e
JOIN "tag" tg ON tg."organization_id" = e.organization_id AND tg."slug" = e.slug
WHERE e.slug <> ''
ON CONFLICT DO NOTHING;