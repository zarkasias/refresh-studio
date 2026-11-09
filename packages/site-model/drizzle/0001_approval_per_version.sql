ALTER TABLE "variants" DROP CONSTRAINT "variants_approved_by_nonempty";--> statement-breakpoint
ALTER TABLE "variants" DROP CONSTRAINT "variants_approval_pair";--> statement-breakpoint
ALTER TABLE "variants" DROP CONSTRAINT "variants_approval_required";--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "number" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "versions" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "variants" DROP COLUMN "approved_at";--> statement-breakpoint
ALTER TABLE "variants" DROP COLUMN "approved_by";--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_variant_number_unique" UNIQUE("variant_id","number");--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_number_positive" CHECK ("versions"."number" >= 1);--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_approved_by_nonempty" CHECK ("versions"."approved_by" IS NULL OR "versions"."approved_by" <> '');--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_approval_pair" CHECK (("versions"."approved_at" IS NULL) = ("versions"."approved_by" IS NULL));--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_approved_after_created" CHECK ("versions"."approved_at" IS NULL OR "versions"."approved_at" >= "versions"."created_at");