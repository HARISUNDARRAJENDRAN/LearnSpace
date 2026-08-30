CREATE TABLE "identity"."auth_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "auth_challenges_purpose_chk" CHECK ("identity"."auth_challenges"."purpose" IN ('email_verification', 'password_reset'))
);
ALTER TABLE "identity"."auth_challenges" ADD CONSTRAINT "auth_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_challenges_token_hash_uq" ON "identity"."auth_challenges" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_challenges_user_purpose_idx" ON "identity"."auth_challenges" USING btree ("user_id","purpose","created_at" DESC NULLS LAST);
REVOKE ALL ON SCHEMA public, catalog, study, activity, retrieval, practice, knowledge, agent, discovery, ops, projection, drizzle FROM learnspace_auth;
REVOKE ALL ON ALL TABLES IN SCHEMA catalog, study, activity, retrieval, practice, knowledge, agent, discovery, ops, projection, drizzle FROM learnspace_auth;
REVOKE ALL ON TABLE identity.users, identity.auth_accounts, identity.auth_sessions, identity.user_settings, identity.auth_challenges FROM learnspace_auth;
GRANT USAGE ON SCHEMA identity TO learnspace_auth;

GRANT SELECT ON TABLE identity.users TO learnspace_auth;
GRANT INSERT (id, email, email_verified, password_hash, status, display_name, avatar_url, locale, timezone, subscription_tier, created_at, updated_at, deleted_at) ON TABLE identity.users TO learnspace_auth;
GRANT UPDATE (email_verified, password_hash, display_name, avatar_url, updated_at) ON TABLE identity.users TO learnspace_auth;

GRANT SELECT ON TABLE identity.auth_accounts TO learnspace_auth;
GRANT INSERT (id, user_id, provider, provider_account_id, provider_email, email_verified, profile, created_at, updated_at) ON TABLE identity.auth_accounts TO learnspace_auth;
GRANT UPDATE (provider_email, email_verified, profile, updated_at) ON TABLE identity.auth_accounts TO learnspace_auth;

GRANT SELECT ON TABLE identity.auth_sessions TO learnspace_auth;
GRANT INSERT (id, user_id, rotation_family_id, refresh_token_hash, rotated_from_id, user_agent, ip_hash, last_seen_at, expires_at, revoked_at, revocation_reason, created_at) ON TABLE identity.auth_sessions TO learnspace_auth;
GRANT UPDATE (last_seen_at, revoked_at, revocation_reason) ON TABLE identity.auth_sessions TO learnspace_auth;

GRANT SELECT ON TABLE identity.user_settings TO learnspace_auth;
GRANT INSERT (user_id, learning_preferences, notification_settings, privacy_settings, accessibility, updated_at) ON TABLE identity.user_settings TO learnspace_auth;

GRANT SELECT ON TABLE identity.auth_challenges TO learnspace_auth;
GRANT INSERT (id, user_id, purpose, token_hash, expires_at, consumed_at, created_at, superseded_at) ON TABLE identity.auth_challenges TO learnspace_auth;
GRANT UPDATE (consumed_at, superseded_at) ON TABLE identity.auth_challenges TO learnspace_auth;

DROP POLICY IF EXISTS identity_users_auth_role_delete_policy ON identity.users;
DROP POLICY IF EXISTS identity_auth_accounts_auth_role_delete_policy ON identity.auth_accounts;
DROP POLICY IF EXISTS identity_auth_sessions_auth_role_delete_policy ON identity.auth_sessions;
DROP POLICY IF EXISTS identity_user_settings_auth_role_delete_policy ON identity.user_settings;

ALTER TABLE identity.auth_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY identity_auth_challenges_auth_role_select_policy ON identity.auth_challenges FOR SELECT TO learnspace_auth USING (true);
CREATE POLICY identity_auth_challenges_auth_role_insert_policy ON identity.auth_challenges FOR INSERT TO learnspace_auth WITH CHECK (true);
CREATE POLICY identity_auth_challenges_auth_role_update_policy ON identity.auth_challenges FOR UPDATE TO learnspace_auth USING (true) WITH CHECK (true);
