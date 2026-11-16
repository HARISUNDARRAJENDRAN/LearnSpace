ALTER TABLE "study"."mastery_checks" ADD COLUMN "written_at" timestamp with time zone;--> statement-breakpoint
-- Every set before this was written whole.
UPDATE "study"."mastery_checks" SET "written_at" = "created_at";
