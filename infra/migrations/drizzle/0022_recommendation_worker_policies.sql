DROP POLICY resource_embeddings_worker ON discovery.resource_embeddings;
--> statement-breakpoint
CREATE POLICY resource_embeddings_worker_select ON discovery.resource_embeddings FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY resource_embeddings_worker_insert ON discovery.resource_embeddings FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY resource_embeddings_worker_update ON discovery.resource_embeddings FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
CREATE POLICY resource_embeddings_worker_delete ON discovery.resource_embeddings FOR DELETE TO learnspace_worker USING (true);
--> statement-breakpoint
DROP POLICY learner_profiles_worker ON discovery.learner_profiles;
--> statement-breakpoint
CREATE POLICY learner_profiles_worker_select ON discovery.learner_profiles FOR SELECT TO learnspace_worker USING (true);
CREATE POLICY learner_profiles_worker_insert ON discovery.learner_profiles FOR INSERT TO learnspace_worker WITH CHECK (true);
CREATE POLICY learner_profiles_worker_update ON discovery.learner_profiles FOR UPDATE TO learnspace_worker USING (true) WITH CHECK (true);
CREATE POLICY learner_profiles_worker_delete ON discovery.learner_profiles FOR DELETE TO learnspace_worker USING (true);
