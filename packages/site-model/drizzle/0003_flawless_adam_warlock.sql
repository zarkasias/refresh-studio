CREATE TABLE "captured_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"capture_run_id" text NOT NULL,
	"url" text NOT NULL,
	"final_url" text NOT NULL,
	"redirect_chain" jsonb NOT NULL,
	"http_status" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"html_asset_id" text NOT NULL,
	"screenshot_mobile_asset_id" text NOT NULL,
	"screenshot_desktop_asset_id" text NOT NULL,
	"facts" jsonb NOT NULL,
	"axe" jsonb,
	"pending_content" jsonb NOT NULL,
	CONSTRAINT "captured_pages_run_url_unique" UNIQUE("capture_run_id","url"),
	CONSTRAINT "captured_pages_http_status_range" CHECK ("captured_pages"."http_status" BETWEEN 100 AND 599)
);
--> statement-breakpoint
CREATE TABLE "crawls" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"site_id" text,
	"start_url" text NOT NULL,
	"status" text NOT NULL,
	"blocked_reason" text,
	"user_agent" text NOT NULL,
	"robots" jsonb NOT NULL,
	"planned" jsonb NOT NULL,
	"skipped" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "crawls_status_values" CHECK ("status" IN ('queued', 'running', 'done', 'failed', 'blocked')),
	CONSTRAINT "crawls_planned_max" CHECK (jsonb_typeof("crawls"."planned") = 'array' AND jsonb_array_length("crawls"."planned") <= 25),
	CONSTRAINT "crawls_finished_after_started" CHECK ("crawls"."finished_at" IS NULL OR "crawls"."finished_at" >= "crawls"."started_at")
);
--> statement-breakpoint
ALTER TABLE "captured_pages" ADD CONSTRAINT "captured_pages_capture_run_id_crawls_id_fk" FOREIGN KEY ("capture_run_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawls" ADD CONSTRAINT "crawls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawls" ADD CONSTRAINT "crawls_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "captured_pages_capture_run_id_idx" ON "captured_pages" USING btree ("capture_run_id");--> statement-breakpoint
CREATE INDEX "crawls_project_id_idx" ON "crawls" USING btree ("project_id");