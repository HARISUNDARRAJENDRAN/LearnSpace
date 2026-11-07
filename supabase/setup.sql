-- Supabase-only wiring for the serverless discovery worker. Run once as `postgres` in the SQL editor after
-- `pnpm db:migrate`, and again after changing it; every statement is idempotent. It needs two Vault secrets:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/discovery-worker', 'discovery_worker_url');
--   select vault.create_secret('<the function''s WORKER_TRIGGER_SECRET>', 'discovery_worker_secret');
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

CREATE SCHEMA IF NOT EXISTS hosting;
REVOKE ALL ON SCHEMA hosting FROM PUBLIC;

-- Queues one HTTP call to the worker; pg_net sends it only if the calling transaction commits.
CREATE OR REPLACE FUNCTION hosting.call_discovery_worker(housekeeping boolean) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'discovery_worker_url'),
    body := jsonb_build_object('housekeeping', housekeeping),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'discovery_worker_secret')
    ),
    timeout_milliseconds := 5000
  );
$$;

CREATE OR REPLACE FUNCTION hosting.wake_discovery_worker() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM hosting.call_discovery_worker(false);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION hosting.call_discovery_worker(boolean), hosting.wake_discovery_worker() FROM PUBLIC;
GRANT USAGE ON SCHEMA hosting TO learnspace_migrator;
GRANT EXECUTE ON FUNCTION hosting.wake_discovery_worker() TO learnspace_migrator;

-- The outbox table belongs to the migrator, so the trigger is created as that role.
GRANT learnspace_migrator TO postgres WITH SET TRUE;
SET ROLE learnspace_migrator;
DROP TRIGGER IF EXISTS outbox_events_wake_discovery_worker ON ops.outbox_events;
CREATE TRIGGER outbox_events_wake_discovery_worker AFTER INSERT ON ops.outbox_events
FOR EACH ROW WHEN (NEW.event_type IN ('discovery.refresh_requested', 'discovery.candidates_discovered'))
EXECUTE FUNCTION hosting.wake_discovery_worker();
RESET ROLE;

-- Reclaims expired leases, schedules due refreshes, keeps YouTube metrics fresh and runs recommendation upkeep.
SELECT cron.schedule('discovery-worker-housekeeping', '*/5 * * * *', 'SELECT hosting.call_discovery_worker(true)');
