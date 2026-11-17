CREATE TABLE "discovery"."favorite_authors" (
	"user_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"followed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorite_authors_user_id_author_id_pk" PRIMARY KEY("user_id","author_id")
);
--> statement-breakpoint
ALTER TABLE "discovery"."favorite_authors" ADD CONSTRAINT "favorite_authors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."favorite_authors" ADD CONSTRAINT "favorite_authors_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "catalog"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "favorite_authors_user_followed_idx" ON "discovery"."favorite_authors" USING btree ("user_id","followed_at" DESC NULLS LAST);--> statement-breakpoint
-- A learner's followed authors are private to them.
ALTER TABLE discovery.favorite_authors ENABLE ROW LEVEL SECURITY;
CREATE POLICY favorite_authors_owner_policy ON discovery.favorite_authors FOR SELECT TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY favorite_authors_owner_insert_policy ON discovery.favorite_authors FOR INSERT TO learnspace_app WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY favorite_authors_owner_delete_policy ON discovery.favorite_authors FOR DELETE TO learnspace_app USING (user_id::text = current_setting('app.user_id', true));
GRANT SELECT, INSERT, DELETE ON TABLE discovery.favorite_authors TO learnspace_app;
