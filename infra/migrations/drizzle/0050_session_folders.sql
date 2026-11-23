CREATE TABLE "study"."session_folder_memberships" (
	"folder_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"study_session_id" uuid PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study"."session_folder_resources" (
	"folder_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_folder_resources_folder_id_resource_id_pk" PRIMARY KEY("folder_id","resource_id")
);
--> statement-breakpoint
CREATE TABLE "study"."session_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_folders_user_id_uq" UNIQUE("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "study"."session_folder_memberships" ADD CONSTRAINT "session_folder_memberships_folder_fk" FOREIGN KEY ("user_id","folder_id") REFERENCES "study"."session_folders"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_folder_memberships" ADD CONSTRAINT "session_folder_memberships_session_fk" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_folder_resources" ADD CONSTRAINT "session_folder_resources_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_folder_resources" ADD CONSTRAINT "session_folder_resources_folder_fk" FOREIGN KEY ("user_id","folder_id") REFERENCES "study"."session_folders"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_folders" ADD CONSTRAINT "session_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_folder_memberships_order_idx" ON "study"."session_folder_memberships" USING btree ("user_id","folder_id","position","study_session_id");--> statement-breakpoint
CREATE INDEX "session_folder_resources_order_idx" ON "study"."session_folder_resources" USING btree ("user_id","folder_id","position","resource_id");--> statement-breakpoint
CREATE INDEX "session_folder_resources_resource_idx" ON "study"."session_folder_resources" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "session_folders_order_idx" ON "study"."session_folders" USING btree ("user_id","position","id");--> statement-breakpoint
ALTER TABLE study.session_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE study.session_folder_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE study.session_folder_resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY session_folders_owner_select ON study.session_folders FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY session_folders_owner_insert ON study.session_folders FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY session_folders_owner_update ON study.session_folders FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY session_folders_owner_delete ON study.session_folders FOR DELETE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));

CREATE POLICY session_folder_memberships_owner_select ON study.session_folder_memberships FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY session_folder_memberships_owner_insert ON study.session_folder_memberships FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY session_folder_memberships_owner_update ON study.session_folder_memberships FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY session_folder_memberships_owner_delete ON study.session_folder_memberships FOR DELETE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));

CREATE POLICY session_folder_resources_owner_select ON study.session_folder_resources FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY session_folder_resources_owner_insert ON study.session_folder_resources FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true) AND EXISTS (
      SELECT 1 FROM catalog.resources r WHERE r.id = resource_id AND r.deleted_at IS NULL AND r.type IN ('paper', 'pdf', 'video')
    ));
CREATE POLICY session_folder_resources_owner_update ON study.session_folder_resources FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
CREATE POLICY session_folder_resources_owner_delete ON study.session_folder_resources FOR DELETE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));

GRANT SELECT, INSERT, DELETE ON study.session_folders, study.session_folder_memberships, study.session_folder_resources TO learnspace_app;
GRANT UPDATE (title, description, position, updated_at) ON study.session_folders TO learnspace_app;
GRANT UPDATE (folder_id, position, added_at) ON study.session_folder_memberships TO learnspace_app;
GRANT UPDATE (position) ON study.session_folder_resources TO learnspace_app;
