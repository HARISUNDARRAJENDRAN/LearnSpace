CREATE TABLE "discovery"."learner_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery"."resource_embeddings" (
	"resource_id" uuid NOT NULL,
	"model" text NOT NULL,
	"source_hash" text NOT NULL,
	"embedding" vector(1536),
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_embeddings_resource_id_model_pk" PRIMARY KEY("resource_id","model"),
	CONSTRAINT "resource_embeddings_nonzero_chk" CHECK ("discovery"."resource_embeddings"."embedding" IS NULL OR vector_norm("discovery"."resource_embeddings"."embedding") > 0)
);
--> statement-breakpoint
ALTER TABLE "discovery"."learner_profiles" ADD CONSTRAINT "learner_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."resource_embeddings" ADD CONSTRAINT "resource_embeddings_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resource_embeddings_cosine_hnsw_idx" ON "discovery"."resource_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "resource_embeddings_retry_idx" ON "discovery"."resource_embeddings" USING btree ("retry_at") WHERE "discovery"."resource_embeddings"."embedding" IS NULL;
--> statement-breakpoint
ALTER TABLE discovery.resource_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY resource_embeddings_visible ON discovery.resource_embeddings FOR SELECT TO learnspace_app USING (
  EXISTS (SELECT 1 FROM catalog.resources r WHERE r.id = resource_id AND (r.owner_user_id::text = current_setting('app.user_id', true) OR r.visibility IN ('public', 'unlisted')))
);
CREATE POLICY resource_embeddings_worker ON discovery.resource_embeddings FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
GRANT SELECT ON discovery.resource_embeddings TO learnspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON discovery.resource_embeddings TO learnspace_worker;
--> statement-breakpoint
ALTER TABLE discovery.learner_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY learner_profiles_owner ON discovery.learner_profiles FOR SELECT TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY learner_profiles_worker ON discovery.learner_profiles FOR ALL TO learnspace_worker USING (true) WITH CHECK (true);
GRANT SELECT ON discovery.learner_profiles TO learnspace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON discovery.learner_profiles TO learnspace_worker;

--> statement-breakpoint
GRANT SELECT ON identity.user_settings TO learnspace_worker;
CREATE POLICY recommendation_worker_read ON identity.user_settings FOR SELECT TO learnspace_worker USING (true);

--> statement-breakpoint
GRANT SELECT ON study.learning_goals TO learnspace_worker;
CREATE POLICY recommendation_worker_read ON study.learning_goals FOR SELECT TO learnspace_worker USING (true);

--> statement-breakpoint
GRANT SELECT ON study.user_resource_progress TO learnspace_worker;
CREATE POLICY recommendation_worker_read ON study.user_resource_progress FOR SELECT TO learnspace_worker USING (true);

--> statement-breakpoint
GRANT SELECT ON catalog.library_items TO learnspace_worker;
CREATE POLICY recommendation_worker_read ON catalog.library_items FOR SELECT TO learnspace_worker USING (true);

--> statement-breakpoint
GRANT SELECT ON catalog.collection_enrollments TO learnspace_worker;
CREATE POLICY recommendation_worker_read ON catalog.collection_enrollments FOR SELECT TO learnspace_worker USING (true);

--> statement-breakpoint
GRANT SELECT ON catalog.collection_items TO learnspace_worker;
CREATE POLICY recommendation_worker_read ON catalog.collection_items FOR SELECT TO learnspace_worker USING (true);

--> statement-breakpoint
GRANT SELECT ON catalog.collection_sections TO learnspace_worker;
CREATE POLICY recommendation_worker_read ON catalog.collection_sections FOR SELECT TO learnspace_worker USING (true);

--> statement-breakpoint
GRANT SELECT ON catalog.collections TO learnspace_worker;
CREATE POLICY recommendation_worker_read ON catalog.collections FOR SELECT TO learnspace_worker USING (true);
