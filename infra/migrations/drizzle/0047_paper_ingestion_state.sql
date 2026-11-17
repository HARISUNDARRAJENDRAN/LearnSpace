ALTER TABLE catalog.resource_versions
  ADD COLUMN processing_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN retry_after timestamptz,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
