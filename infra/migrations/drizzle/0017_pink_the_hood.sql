ALTER TABLE "study"."session_resources" ADD COLUMN "introduced_by_resource_id" uuid;--> statement-breakpoint
ALTER TABLE "study"."session_resources" ADD COLUMN "introduced_from_anchor" jsonb;--> statement-breakpoint
ALTER TABLE "study"."session_resources" ADD COLUMN "introduced_reason_code" text;--> statement-breakpoint
ALTER TABLE "study"."session_resources" ADD CONSTRAINT "session_resources_introduced_by_resource_fkey" FOREIGN KEY ("study_session_id","introduced_by_resource_id") REFERENCES "study"."session_resources"("study_session_id","resource_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_resources" ADD CONSTRAINT "session_resources_introduction_pair_chk" CHECK (("study"."session_resources"."introduced_by_resource_id" IS NULL) = ("study"."session_resources"."introduced_reason_code" IS NULL));--> statement-breakpoint
ALTER TABLE "study"."session_resources" ADD CONSTRAINT "session_resources_introduction_reason_chk" CHECK ("study"."session_resources"."introduced_reason_code" IS NULL OR "study"."session_resources"."introduced_reason_code" IN ('related_explanation', 'deeper_dive'));
