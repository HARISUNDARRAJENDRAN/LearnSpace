ALTER TABLE "study"."study_sessions" ADD COLUMN "workspace" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "study"."study_sessions" ADD COLUMN "position" integer;