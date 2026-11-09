CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_url" text NOT NULL,
	"storage_path" text,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"alt" text,
	CONSTRAINT "assets_kind_values" CHECK ("kind" IN ('image', 'logo', 'font', 'screenshot', 'document')),
	CONSTRAINT "assets_width_positive" CHECK ("assets"."width" IS NULL OR "assets"."width" > 0),
	CONSTRAINT "assets_height_positive" CHECK ("assets"."height" IS NULL OR "assets"."height" > 0),
	CONSTRAINT "assets_bytes_nonnegative" CHECK ("assets"."bytes" IS NULL OR "assets"."bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"section_id" text,
	"x" double precision,
	"y" double precision,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"resolved" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "comments_author_values" CHECK ("author" IN ('consultant', 'client'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"client_name" text NOT NULL,
	"site_url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"consent_granted_by" text,
	"consent_granted_at" timestamp with time zone,
	"consent_method" text,
	"consent_origin" text,
	"consent_path_prefix" text,
	"consent_max_pages" integer,
	"consent_evidence_asset_id" text,
	CONSTRAINT "projects_consent_max_pages_range" CHECK ("projects"."consent_max_pages" IS NULL OR "projects"."consent_max_pages" BETWEEN 1 AND 25),
	CONSTRAINT "projects_consent_all_or_none" CHECK (("projects"."consent_granted_by" IS NULL AND "projects"."consent_granted_at" IS NULL AND "projects"."consent_method" IS NULL AND "projects"."consent_origin" IS NULL AND "projects"."consent_max_pages" IS NULL AND "projects"."consent_path_prefix" IS NULL AND "projects"."consent_evidence_asset_id" IS NULL)
        OR ("projects"."consent_granted_by" IS NOT NULL AND "projects"."consent_granted_at" IS NOT NULL AND "projects"."consent_method" IS NOT NULL AND "projects"."consent_origin" IS NOT NULL AND "projects"."consent_max_pages" IS NOT NULL)),
	CONSTRAINT "projects_consent_method_values" CHECK ("projects"."consent_method" IS NULL OR "consent_method" IN ('email', 'signed', 'own-site'))
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"doc" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"name" text NOT NULL,
	"style" text NOT NULL,
	"status" text NOT NULL,
	"tokens" jsonb NOT NULL,
	"templates" jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	CONSTRAINT "variants_style_values" CHECK ("style" IN ('conservative', 'modern', 'bold')),
	CONSTRAINT "variants_status_values" CHECK ("status" IN ('draft', 'approved', 'shared', 'selected')),
	CONSTRAINT "variants_approved_by_nonempty" CHECK ("variants"."approved_by" IS NULL OR "variants"."approved_by" <> ''),
	CONSTRAINT "variants_approval_pair" CHECK (("variants"."approved_at" IS NULL) = ("variants"."approved_by" IS NULL)),
	CONSTRAINT "variants_approval_required" CHECK ("variants"."status" NOT IN ('approved', 'shared', 'selected') OR ("variants"."approved_at" IS NOT NULL AND "variants"."approved_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_site_id_idx" ON "assets" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "comments_version_id_idx" ON "comments" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "sites_project_id_idx" ON "sites" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "variants_site_id_idx" ON "variants" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "versions_variant_id_idx" ON "versions" USING btree ("variant_id");