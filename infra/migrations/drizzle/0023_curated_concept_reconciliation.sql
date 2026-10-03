GRANT DELETE ON catalog.resource_concepts TO learnspace_worker;
--> statement-breakpoint
CREATE POLICY resource_concepts_curated_worker_delete ON catalog.resource_concepts FOR DELETE TO learnspace_worker
USING (source = 'curated-curriculum-v1' AND EXISTS (
  SELECT 1 FROM catalog.resources r WHERE r.id = resource_id
    AND r.owner_user_id IS NULL AND r.visibility IN ('public', 'unlisted')
));
