-- The source picker's video agent checks every hit against the YouTube Data API, so web instances spend the same daily
-- YouTube quota the worker's metrics refresh does; both count it in the one 'youtube' row.
ALTER POLICY api_usage_daily_app_select ON ops.api_usage_daily USING (provider LIKE 'tutor:%' OR provider = 'youtube');
--> statement-breakpoint
ALTER POLICY api_usage_daily_app_insert ON ops.api_usage_daily WITH CHECK (provider LIKE 'tutor:%' OR provider = 'youtube');
--> statement-breakpoint
ALTER POLICY api_usage_daily_app_update ON ops.api_usage_daily USING (provider LIKE 'tutor:%' OR provider = 'youtube') WITH CHECK (provider LIKE 'tutor:%' OR provider = 'youtube');
