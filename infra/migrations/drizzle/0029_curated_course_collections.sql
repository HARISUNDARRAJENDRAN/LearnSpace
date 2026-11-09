-- The worker publishes each Discover course as a curated collection; it may write only LearnSpace-owned curated rows.
GRANT INSERT, UPDATE ON catalog.collections TO learnspace_worker;
--> statement-breakpoint
CREATE POLICY curated_worker_insert ON catalog.collections FOR INSERT TO learnspace_worker WITH CHECK (owner_user_id IS NULL AND kind = 'curated');
--> statement-breakpoint
CREATE POLICY curated_worker_update ON catalog.collections FOR UPDATE TO learnspace_worker USING (owner_user_id IS NULL AND kind = 'curated') WITH CHECK (owner_user_id IS NULL AND kind = 'curated');
--> statement-breakpoint
GRANT INSERT, UPDATE ON catalog.collection_sections TO learnspace_worker;
--> statement-breakpoint
CREATE POLICY curated_worker_insert ON catalog.collection_sections FOR INSERT TO learnspace_worker WITH CHECK (EXISTS (SELECT 1 FROM catalog.collections c WHERE c.id = collection_id AND c.owner_user_id IS NULL AND c.kind = 'curated'));
--> statement-breakpoint
CREATE POLICY curated_worker_update ON catalog.collection_sections FOR UPDATE TO learnspace_worker USING (EXISTS (SELECT 1 FROM catalog.collections c WHERE c.id = collection_id AND c.owner_user_id IS NULL AND c.kind = 'curated'));
--> statement-breakpoint
GRANT INSERT, UPDATE ON catalog.collection_items TO learnspace_worker;
--> statement-breakpoint
CREATE POLICY curated_worker_insert ON catalog.collection_items FOR INSERT TO learnspace_worker WITH CHECK (EXISTS (SELECT 1 FROM catalog.collection_sections s JOIN catalog.collections c ON c.id = s.collection_id WHERE s.id = section_id AND c.owner_user_id IS NULL AND c.kind = 'curated'));
--> statement-breakpoint
CREATE POLICY curated_worker_update ON catalog.collection_items FOR UPDATE TO learnspace_worker USING (EXISTS (SELECT 1 FROM catalog.collection_sections s JOIN catalog.collections c ON c.id = s.collection_id WHERE s.id = section_id AND c.owner_user_id IS NULL AND c.kind = 'curated'));
