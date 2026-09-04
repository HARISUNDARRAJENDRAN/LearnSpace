ALTER TABLE "study"."study_sessions" DROP CONSTRAINT "study_sessions_active_pin_pair_chk";
ALTER TABLE "study"."session_resources" ALTER COLUMN "resource_version_id" DROP NOT NULL;
ALTER TABLE "study"."session_resources" ADD COLUMN "binding_status" text DEFAULT 'ready' NOT NULL;
ALTER TABLE "study"."session_resources" ADD CONSTRAINT "session_resources_binding_status_chk" CHECK ("study"."session_resources"."binding_status" IN ('preparing', 'ready'));
ALTER TABLE "study"."session_resources" ADD CONSTRAINT "session_resources_binding_provenance_chk" CHECK (("study"."session_resources"."resource_version_id" IS NULL AND "study"."session_resources"."binding_status" = 'preparing') OR ("study"."session_resources"."resource_version_id" IS NOT NULL AND "study"."session_resources"."binding_status" = 'ready'));
ALTER TABLE "study"."study_sessions" ADD CONSTRAINT "study_sessions_active_pin_pair_chk" CHECK ("study"."study_sessions"."active_resource_id" IS NOT NULL OR "study"."study_sessions"."active_version_id" IS NULL);
