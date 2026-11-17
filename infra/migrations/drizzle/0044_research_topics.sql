CREATE TABLE "discovery"."research_topics" (
	"user_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_topics_user_id_concept_id_pk" PRIMARY KEY("user_id","concept_id")
);
--> statement-breakpoint
ALTER TABLE "discovery"."research_topics" ADD CONSTRAINT "research_topics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."research_topics" ADD CONSTRAINT "research_topics_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- A reader's Research topics are private to them.
ALTER TABLE discovery.research_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY research_topics_owner_policy ON discovery.research_topics FOR SELECT TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY research_topics_owner_insert_policy ON discovery.research_topics FOR INSERT TO learnspace_app WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY research_topics_owner_delete_policy ON discovery.research_topics FOR DELETE TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
GRANT SELECT, INSERT, DELETE ON TABLE discovery.research_topics TO learnspace_app;
