-- Wakes the discovery worker the moment a discovery request commits, instead of on its next poll.
CREATE FUNCTION ops.notify_discovery_wake() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_notify('discovery_wake', '');
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER outbox_events_discovery_wake AFTER INSERT ON ops.outbox_events
FOR EACH ROW WHEN (NEW.event_type IN ('discovery.refresh_requested', 'discovery.candidates_discovered'))
EXECUTE FUNCTION ops.notify_discovery_wake();
