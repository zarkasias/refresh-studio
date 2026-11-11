CREATE TABLE "audit_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"audit_run_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"site_id" text NOT NULL,
	"capture_run_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"tool_versions" jsonb NOT NULL,
	"lighthouse" jsonb NOT NULL,
	"checks" jsonb NOT NULL,
	"scores" jsonb NOT NULL,
	"weights_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"report_version_id" text NOT NULL,
	"channel" text NOT NULL,
	"recipient_name" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "report_deliveries_channel_values" CHECK ("channel" IN ('email-pdf', 'share-link'))
);
--> statement-breakpoint
CREATE TABLE "report_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"report_version_id" text NOT NULL,
	"kind" text NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "report_exports_kind_values" CHECK ("kind" IN ('pdf')),
	CONSTRAINT "report_exports_sha256_hex" CHECK ("report_exports"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "report_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"number" integer NOT NULL,
	"doc" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	CONSTRAINT "report_versions_report_number_unique" UNIQUE("report_id","number"),
	CONSTRAINT "report_versions_number_positive" CHECK ("report_versions"."number" >= 1),
	CONSTRAINT "report_versions_approved_by_nonempty" CHECK ("report_versions"."approved_by" IS NULL OR "report_versions"."approved_by" <> ''),
	CONSTRAINT "report_versions_approval_pair" CHECK (("report_versions"."approved_at" IS NULL) = ("report_versions"."approved_by" IS NULL)),
	CONSTRAINT "report_versions_approved_after_created" CHECK ("report_versions"."approved_at" IS NULL OR "report_versions"."approved_at" >= "report_versions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "share_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "share_links_token_hash_sha256" CHECK ("share_links"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "share_links_expires_after_created" CHECK ("share_links"."expires_at" > "share_links"."created_at")
);
--> statement-breakpoint
ALTER TABLE "audit_reports" ADD CONSTRAINT "audit_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_reports" ADD CONSTRAINT "audit_reports_audit_run_id_audit_runs_id_fk" FOREIGN KEY ("audit_run_id") REFERENCES "public"."audit_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_runs" ADD CONSTRAINT "audit_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_runs" ADD CONSTRAINT "audit_runs_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_runs" ADD CONSTRAINT "audit_runs_capture_run_id_crawls_id_fk" FOREIGN KEY ("capture_run_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_deliveries" ADD CONSTRAINT "report_deliveries_report_version_id_report_versions_id_fk" FOREIGN KEY ("report_version_id") REFERENCES "public"."report_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_report_version_id_report_versions_id_fk" FOREIGN KEY ("report_version_id") REFERENCES "public"."report_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_report_id_audit_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."audit_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_report_id_audit_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."audit_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_reports_project_id_idx" ON "audit_reports" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_reports_audit_run_id_idx" ON "audit_reports" USING btree ("audit_run_id");--> statement-breakpoint
CREATE INDEX "audit_runs_project_id_idx" ON "audit_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "audit_runs_capture_run_id_idx" ON "audit_runs" USING btree ("capture_run_id");--> statement-breakpoint
CREATE INDEX "report_deliveries_report_version_id_idx" ON "report_deliveries" USING btree ("report_version_id");--> statement-breakpoint
CREATE INDEX "report_exports_report_version_id_idx" ON "report_exports" USING btree ("report_version_id");--> statement-breakpoint
CREATE INDEX "report_versions_report_id_idx" ON "report_versions" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "share_links_report_id_idx" ON "share_links" USING btree ("report_id");