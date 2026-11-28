CREATE TABLE "study"."session_folder_share_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"cloned_folder_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_folder_imports_share_user_uq" UNIQUE("share_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "study"."session_folder_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" char(64) NOT NULL,
	"token_ciphertext" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_folder_shares_token_hash_uq" UNIQUE("token_hash"),
	CONSTRAINT "session_folder_shares_hash_chk" CHECK ("study"."session_folder_shares"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "study"."session_folder_share_imports" ADD CONSTRAINT "session_folder_imports_share_fk" FOREIGN KEY ("share_id") REFERENCES "study"."session_folder_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_folder_share_imports" ADD CONSTRAINT "session_folder_imports_user_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_folder_share_imports" ADD CONSTRAINT "session_folder_imports_folder_fk" FOREIGN KEY ("user_id","cloned_folder_id") REFERENCES "study"."session_folders"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_folder_shares" ADD CONSTRAINT "session_folder_shares_folder_fk" FOREIGN KEY ("user_id","folder_id") REFERENCES "study"."session_folders"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_folder_imports_user_idx" ON "study"."session_folder_share_imports" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "session_folder_shares_active_uq" ON "study"."session_folder_shares" USING btree ("folder_id") WHERE "study"."session_folder_shares"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "session_folder_shares_user_folder_idx" ON "study"."session_folder_shares" USING btree ("user_id","folder_id");

--> statement-breakpoint
ALTER TABLE "study"."session_folder_shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "study"."session_folder_share_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY session_folder_shares_owner_select ON study.session_folder_shares FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY session_folder_shares_owner_insert ON study.session_folder_shares FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY session_folder_shares_owner_update ON study.session_folder_shares FOR UPDATE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY session_folder_shares_owner_delete ON study.session_folder_shares FOR DELETE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY session_folder_imports_owner_select ON study.session_folder_share_imports FOR SELECT TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY session_folder_imports_owner_insert ON study.session_folder_share_imports FOR INSERT TO learnspace_app
  WITH CHECK (user_id::text = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY session_folder_imports_owner_delete ON study.session_folder_share_imports FOR DELETE TO learnspace_app
  USING (user_id::text = current_setting('app.user_id', true));--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON study.session_folder_shares TO learnspace_app;--> statement-breakpoint
GRANT UPDATE (revoked_at, updated_at) ON study.session_folder_shares TO learnspace_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON study.session_folder_share_imports TO learnspace_app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION study.resolve_shared_folder(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, study, catalog
AS $$
DECLARE
  share_row record;
  caller_is_owner boolean;
  materials_json jsonb;
BEGIN
  IF session_user NOT IN ('learnspace_app', 'learnspace_migrator') THEN
    RAISE EXCEPTION 'resolve_shared_folder is restricted to application roles' USING ERRCODE = '42501';
  END IF;

  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;

  SELECT s.id, s.folder_id, s.user_id, f.title, f.description
  INTO share_row
  FROM study.session_folder_shares s
  JOIN study.session_folders f ON f.id = s.folder_id AND f.user_id = s.user_id
  WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  caller_is_owner := (share_row.user_id::text = current_setting('app.user_id', true));

  WITH members AS (
    SELECT sr.resource_id, s.active_resource_id = sr.resource_id AS active,
      m.position AS session_position, sr.position AS resource_position, m.study_session_id
    FROM study.session_folder_memberships m
    JOIN study.study_sessions s ON s.id = m.study_session_id
    JOIN study.session_resources sr ON sr.study_session_id = s.id
    WHERE m.user_id = share_row.user_id AND m.folder_id = share_row.folder_id AND s.status <> 'abandoned'
  ), links AS (
    SELECT DISTINCT ON (resource_id) resource_id, session_position, resource_position
    FROM members
    ORDER BY resource_id, active DESC NULLS LAST, session_position, resource_position, study_session_id
  ), saved AS (
    SELECT resource_id, position
    FROM study.session_folder_resources
    WHERE user_id = share_row.user_id AND folder_id = share_row.folder_id
  ), ordered AS (
    SELECT
      row_number() OVER (ORDER BY links.session_position NULLS LAST, links.resource_position NULLS LAST, saved.position NULLS LAST, r.id) AS ord,
      r.id,
      r.visibility,
      r.type,
      r.provider,
      r.external_id,
      r.canonical_url,
      r.title,
      coalesce(r.description, pd.abstract) AS description,
      r.language,
      jsonb_strip_nulls(jsonb_build_object(
        'thumbnailUrl', CASE WHEN jsonb_typeof(r.metadata->'thumbnailUrl') = 'string' THEN r.metadata->>'thumbnailUrl' END,
        'channelTitle', coalesce(vd.channel_title, CASE WHEN jsonb_typeof(r.metadata->'channelTitle') = 'string' THEN r.metadata->>'channelTitle' END),
        'authors', CASE WHEN jsonb_typeof(r.metadata->'authors') = 'array' THEN r.metadata->'authors' END,
        'venue', coalesce(pd.venue, CASE WHEN jsonb_typeof(r.metadata->'venue') = 'string' THEN r.metadata->>'venue' END),
        'year', coalesce(
          CASE WHEN pd.publication_date IS NOT NULL THEN extract(year FROM pd.publication_date)::int END,
          CASE WHEN (r.metadata->>'year') ~ '^[0-9]{4}$' THEN (r.metadata->>'year')::int END
        ),
        'pdfSourceUrl', coalesce(pd.pdf_source_url, CASE WHEN jsonb_typeof(r.metadata->'pdfSourceUrl') = 'string' THEN r.metadata->>'pdfSourceUrl' END),
        'arxivId', coalesce(pd.arxiv_id, CASE WHEN jsonb_typeof(r.metadata->'arxivId') = 'string' THEN r.metadata->>'arxivId' END),
        'doi', coalesce(pd.doi, CASE WHEN jsonb_typeof(r.metadata->'doi') = 'string' THEN r.metadata->>'doi' END)
      )) AS metadata
    FROM links FULL JOIN saved USING (resource_id)
    JOIN catalog.resources r ON r.id = coalesce(links.resource_id, saved.resource_id)
    LEFT JOIN catalog.video_details vd ON vd.resource_id = r.id
    LEFT JOIN catalog.paper_details pd ON pd.resource_id = r.id
    WHERE r.deleted_at IS NULL AND r.type IN ('paper', 'pdf', 'video')
    ORDER BY links.session_position NULLS LAST, links.resource_position NULLS LAST, saved.position NULLS LAST, r.id
    LIMIT 200
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'resourceId', CASE WHEN visibility IN ('public', 'unlisted') THEN id ELSE NULL END,
    'visibility', visibility,
    'type', type,
    'provider', provider,
    'externalId', external_id,
    'canonicalUrl', canonical_url,
    'title', title,
    'description', description,
    'language', language,
    'metadata', metadata
  ) ORDER BY ord), '[]'::jsonb)
  INTO materials_json
  FROM ordered;

  RETURN jsonb_build_object(
    'shareId', share_row.id,
    'folderId', CASE WHEN caller_is_owner THEN share_row.folder_id ELSE NULL END,
    'isOwner', caller_is_owner,
    'title', share_row.title,
    'description', share_row.description,
    'materials', materials_json
  );
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION study.resolve_shared_folder(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION study.resolve_shared_folder(text) TO learnspace_app, learnspace_migrator;
