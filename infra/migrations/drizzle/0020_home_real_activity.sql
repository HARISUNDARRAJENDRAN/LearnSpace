ALTER TABLE "identity"."user_settings" ADD COLUMN "first_application_visit_at" timestamp with time zone;
--> statement-breakpoint
-- Before this state existed, completing onboarding led directly into the app.
-- Preserve normal navigation for those existing accounts, including quiet ones.
UPDATE identity.user_settings
SET first_application_visit_at = onboarding_completed_at
WHERE onboarding_completed_at IS NOT NULL;
