CREATE TABLE "ops"."rate_limit_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- Shared by every web server instance, so limits hold however many instances serve requests.
ALTER TABLE ops.rate_limit_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY rate_limit_counters_auth_select ON ops.rate_limit_counters FOR SELECT TO learnspace_auth USING (true);
CREATE POLICY rate_limit_counters_auth_insert ON ops.rate_limit_counters FOR INSERT TO learnspace_auth WITH CHECK (true);
CREATE POLICY rate_limit_counters_auth_update ON ops.rate_limit_counters FOR UPDATE TO learnspace_auth USING (true) WITH CHECK (true);
CREATE POLICY rate_limit_counters_worker_delete ON ops.rate_limit_counters FOR DELETE TO learnspace_worker USING (true);
CREATE POLICY rate_limit_counters_worker_select ON ops.rate_limit_counters FOR SELECT TO learnspace_worker USING (true);
GRANT USAGE ON SCHEMA ops TO learnspace_auth;
GRANT SELECT, INSERT, UPDATE ON ops.rate_limit_counters TO learnspace_auth;
GRANT SELECT, DELETE ON ops.rate_limit_counters TO learnspace_worker;
