DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'resource_versions_resource_id_id_uq'
      AND conrelid = 'catalog.resource_versions'::regclass
  ) THEN
    ALTER TABLE "catalog"."resource_versions" ADD CONSTRAINT "resource_versions_resource_id_id_uq" UNIQUE("resource_id","id");
  END IF;
END
$$;
