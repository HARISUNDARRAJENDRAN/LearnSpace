GRANT USAGE ON SCHEMA identity TO learnspace_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE identity.users, identity.auth_accounts, identity.auth_sessions, identity.user_settings TO learnspace_auth;

ALTER TABLE identity.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_users_auth_role_select_policy ON identity.users;
DROP POLICY IF EXISTS identity_users_auth_role_insert_policy ON identity.users;
DROP POLICY IF EXISTS identity_users_auth_role_update_policy ON identity.users;
DROP POLICY IF EXISTS identity_users_auth_role_delete_policy ON identity.users;
CREATE POLICY identity_users_auth_role_select_policy ON identity.users FOR SELECT TO learnspace_auth USING (true);
CREATE POLICY identity_users_auth_role_insert_policy ON identity.users FOR INSERT TO learnspace_auth WITH CHECK (true);
CREATE POLICY identity_users_auth_role_update_policy ON identity.users FOR UPDATE TO learnspace_auth USING (true) WITH CHECK (true);
CREATE POLICY identity_users_auth_role_delete_policy ON identity.users FOR DELETE TO learnspace_auth USING (true);

ALTER TABLE identity.auth_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_auth_accounts_auth_role_select_policy ON identity.auth_accounts;
DROP POLICY IF EXISTS identity_auth_accounts_auth_role_insert_policy ON identity.auth_accounts;
DROP POLICY IF EXISTS identity_auth_accounts_auth_role_update_policy ON identity.auth_accounts;
DROP POLICY IF EXISTS identity_auth_accounts_auth_role_delete_policy ON identity.auth_accounts;
CREATE POLICY identity_auth_accounts_auth_role_select_policy ON identity.auth_accounts FOR SELECT TO learnspace_auth USING (true);
CREATE POLICY identity_auth_accounts_auth_role_insert_policy ON identity.auth_accounts FOR INSERT TO learnspace_auth WITH CHECK (true);
CREATE POLICY identity_auth_accounts_auth_role_update_policy ON identity.auth_accounts FOR UPDATE TO learnspace_auth USING (true) WITH CHECK (true);
CREATE POLICY identity_auth_accounts_auth_role_delete_policy ON identity.auth_accounts FOR DELETE TO learnspace_auth USING (true);

ALTER TABLE identity.auth_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_auth_sessions_auth_role_select_policy ON identity.auth_sessions;
DROP POLICY IF EXISTS identity_auth_sessions_auth_role_insert_policy ON identity.auth_sessions;
DROP POLICY IF EXISTS identity_auth_sessions_auth_role_update_policy ON identity.auth_sessions;
DROP POLICY IF EXISTS identity_auth_sessions_auth_role_delete_policy ON identity.auth_sessions;
CREATE POLICY identity_auth_sessions_auth_role_select_policy ON identity.auth_sessions FOR SELECT TO learnspace_auth USING (true);
CREATE POLICY identity_auth_sessions_auth_role_insert_policy ON identity.auth_sessions FOR INSERT TO learnspace_auth WITH CHECK (true);
CREATE POLICY identity_auth_sessions_auth_role_update_policy ON identity.auth_sessions FOR UPDATE TO learnspace_auth USING (true) WITH CHECK (true);
CREATE POLICY identity_auth_sessions_auth_role_delete_policy ON identity.auth_sessions FOR DELETE TO learnspace_auth USING (true);

ALTER TABLE identity.user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_user_settings_auth_role_select_policy ON identity.user_settings;
DROP POLICY IF EXISTS identity_user_settings_auth_role_insert_policy ON identity.user_settings;
DROP POLICY IF EXISTS identity_user_settings_auth_role_update_policy ON identity.user_settings;
DROP POLICY IF EXISTS identity_user_settings_auth_role_delete_policy ON identity.user_settings;
CREATE POLICY identity_user_settings_auth_role_select_policy ON identity.user_settings FOR SELECT TO learnspace_auth USING (true);
CREATE POLICY identity_user_settings_auth_role_insert_policy ON identity.user_settings FOR INSERT TO learnspace_auth WITH CHECK (true);
CREATE POLICY identity_user_settings_auth_role_update_policy ON identity.user_settings FOR UPDATE TO learnspace_auth USING (true) WITH CHECK (true);
CREATE POLICY identity_user_settings_auth_role_delete_policy ON identity.user_settings FOR DELETE TO learnspace_auth USING (true);
