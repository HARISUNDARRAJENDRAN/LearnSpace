CREATE TABLE "practice"."paper_coding_profiles" (
	"resource_version_id" uuid PRIMARY KEY NOT NULL,
	"resource_id" uuid NOT NULL,
	"status" text NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified_exercises" integer DEFAULT 0 NOT NULL,
	"guide_status" text DEFAULT 'pending' NOT NULL,
	"guide" jsonb,
	"failure" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "paper_coding_profiles_status_chk" CHECK ("practice"."paper_coding_profiles"."status" IN ('planning', 'ready', 'ineligible', 'failed')),
	CONSTRAINT "paper_coding_profiles_guide_status_chk" CHECK ("practice"."paper_coding_profiles"."guide_status" IN ('pending', 'generating', 'ready', 'failed')),
	CONSTRAINT "paper_coding_profiles_verified_chk" CHECK ("practice"."paper_coding_profiles"."verified_exercises" >= 0)
);
--> statement-breakpoint
ALTER TABLE "practice"."paper_coding_profiles" ADD CONSTRAINT "paper_coding_profiles_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "practice"."paper_coding_profiles" ADD CONSTRAINT "paper_coding_profiles_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE practice.paper_coding_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY paper_coding_profiles_app_select ON practice.paper_coding_profiles FOR SELECT TO learnspace_app USING (true);
CREATE POLICY paper_coding_profiles_app_insert ON practice.paper_coding_profiles FOR INSERT TO learnspace_app WITH CHECK (true);
CREATE POLICY paper_coding_profiles_app_update ON practice.paper_coding_profiles FOR UPDATE TO learnspace_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON TABLE practice.paper_coding_profiles TO learnspace_app;
