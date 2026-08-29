CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE SCHEMA "activity";
--> statement-breakpoint
CREATE SCHEMA "agent";
--> statement-breakpoint
CREATE SCHEMA "catalog";
--> statement-breakpoint
CREATE SCHEMA "discovery";
--> statement-breakpoint
CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "knowledge";
--> statement-breakpoint
CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE SCHEMA "practice";
--> statement-breakpoint
CREATE SCHEMA "projection";
--> statement-breakpoint
CREATE SCHEMA "retrieval";
--> statement-breakpoint
CREATE SCHEMA "study";
--> statement-breakpoint
CREATE TYPE "agent"."run_status" AS ENUM('planning', 'executing', 'synthesizing', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "agent"."step_status" AS ENUM('pending', 'running', 'done', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TYPE "practice"."attempt_status" AS ENUM('started', 'running', 'submitted', 'passed', 'failed', 'abandoned');--> statement-breakpoint
CREATE TYPE "practice"."execution_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled');--> statement-breakpoint
CREATE TYPE "practice"."exercise_kind" AS ENUM('code', 'quiz', 'free_response');--> statement-breakpoint
CREATE TYPE "study"."goal_status" AS ENUM('active', 'paused', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "ops"."job_status" AS ENUM('pending', 'running', 'done', 'failed', 'dead', 'cancelled');--> statement-breakpoint
CREATE TYPE "ops"."outbox_status" AS ENUM('pending', 'publishing', 'published', 'dead');--> statement-breakpoint
CREATE TYPE "catalog"."resource_status" AS ENUM('pending', 'processing', 'ready', 'failed', 'archived');--> statement-breakpoint
CREATE TYPE "catalog"."resource_type" AS ENUM('video', 'paper', 'pdf', 'webpage', 'note', 'code', 'diagram', 'canvas', 'research_result');--> statement-breakpoint
CREATE TYPE "catalog"."resource_visibility" AS ENUM('private', 'unlisted', 'public');--> statement-breakpoint
CREATE TYPE "study"."session_mode" AS ENUM('guided_learning', 'research', 'practice', 'review', 'focus');--> statement-breakpoint
CREATE TYPE "study"."session_status" AS ENUM('active', 'paused', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "identity"."subscription_tier" AS ENUM('free', 'pro', 'lifetime');--> statement-breakpoint
CREATE TYPE "identity"."user_status" AS ENUM('active', 'suspended', 'deletion_pending', 'deleted');--> statement-breakpoint
CREATE TABLE "identity"."auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rotation_family_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"rotated_from_id" uuid,
	"user_agent" text,
	"ip_hash" text,
	"last_seen_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"learning_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notification_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"privacy_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accessibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"password_hash" text,
	"status" "identity"."user_status" DEFAULT 'active' NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"subscription_tier" "identity"."subscription_tier" DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_deleted_state_chk" CHECK ("identity"."users"."deleted_at" IS NULL OR "identity"."users"."status" IN ('deletion_pending', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "catalog"."collection_enrollments" (
	"user_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_item_id" uuid,
	"progress_pct" real DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_enrollments_user_id_collection_id_pk" PRIMARY KEY("user_id","collection_id"),
	CONSTRAINT "collection_enrollments_progress_pct_chk" CHECK ("catalog"."collection_enrollments"."progress_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "catalog"."collection_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."collection_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"kind" text NOT NULL,
	"slug" text,
	"visibility" "catalog"."resource_visibility" DEFAULT 'private' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"cover_object_key" text,
	"published_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."resource_concepts" (
	"resource_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"source" text NOT NULL,
	"relevance" real NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"extractor_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_concepts_resource_id_concept_id_source_pk" PRIMARY KEY("resource_id","concept_id","source"),
	CONSTRAINT "resource_concepts_relevance_chk" CHECK ("catalog"."resource_concepts"."relevance" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "catalog"."library_items" (
	"user_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"status" text DEFAULT 'saved' NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_opened_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_items_user_id_resource_id_pk" PRIMARY KEY("user_id","resource_id")
);
--> statement-breakpoint
CREATE TABLE "catalog"."video_details" (
	"resource_id" uuid PRIMARY KEY NOT NULL,
	"youtube_id" text NOT NULL,
	"channel_id" text,
	"channel_title" text,
	"duration_ms" integer,
	"published_at" timestamp with time zone,
	"default_audio_language" text,
	"caption_status" text,
	"latest_view_count" bigint,
	"latest_like_count" bigint,
	"latest_comment_count" bigint,
	"metrics_captured_at" timestamp with time zone,
	"fetched_at" timestamp with time zone,
	CONSTRAINT "video_details_youtube_id_unique" UNIQUE("youtube_id")
);
--> statement-breakpoint
CREATE TABLE "catalog"."video_metric_snapshots" (
	"resource_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"view_count" bigint,
	"like_count" bigint,
	"comment_count" bigint,
	CONSTRAINT "video_metric_snapshots_resource_id_captured_at_pk" PRIMARY KEY("resource_id","captured_at")
);
--> statement-breakpoint
CREATE TABLE "catalog"."authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_name" text NOT NULL,
	"preferred_name" text NOT NULL,
	"orcid" text,
	"semantic_scholar_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authors_orcid_unique" UNIQUE("orcid"),
	CONSTRAINT "authors_semantic_scholar_id_unique" UNIQUE("semantic_scholar_id")
);
--> statement-breakpoint
CREATE TABLE "catalog"."paper_authors" (
	"paper_resource_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"affiliation" text,
	CONSTRAINT "paper_authors_paper_resource_id_author_id_pk" PRIMARY KEY("paper_resource_id","author_id")
);
--> statement-breakpoint
CREATE TABLE "catalog"."paper_details" (
	"resource_id" uuid PRIMARY KEY NOT NULL,
	"arxiv_id" text,
	"doi" text,
	"abstract" text,
	"venue" text,
	"publication_date" date,
	"submitted_at" timestamp with time zone,
	"primary_category" text,
	"license" text,
	"pdf_source_url" text,
	"citation_count" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "paper_details_arxiv_id_unique" UNIQUE("arxiv_id"),
	CONSTRAINT "paper_details_doi_unique" UNIQUE("doi")
);
--> statement-breakpoint
CREATE TABLE "catalog"."paper_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paper_resource_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"raw_reference" text NOT NULL,
	"cited_resource_id" uuid,
	"cited_doi" text,
	"cited_arxiv_id" text,
	"resolution_status" text DEFAULT 'unresolved' NOT NULL,
	"confidence" real,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."resource_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_version_id" uuid NOT NULL,
	"asset_type" text NOT NULL,
	"ordinal" integer NOT NULL,
	"object_key" text NOT NULL,
	"sha256" char(64) NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" bigint,
	"anchor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."resource_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"source_sha256" char(64) NOT NULL,
	"content_sha256" char(64),
	"source_etag" text,
	"source_last_modified" timestamp with time zone,
	"raw_object_key" text NOT NULL,
	"normalized_object_key" text,
	"mime_type" text NOT NULL,
	"byte_size" bigint,
	"parser_name" text,
	"parser_version" text,
	"extraction_version" integer DEFAULT 1 NOT NULL,
	"processing_status" text NOT NULL,
	"failure_code" text,
	"failure_detail" text,
	"fetched_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_versions_version_no_chk" CHECK ("catalog"."resource_versions"."version_no" > 0)
);
--> statement-breakpoint
ALTER TABLE "catalog"."resource_versions" ADD CONSTRAINT "resource_versions_resource_id_id_uq" UNIQUE("resource_id","id");
--> statement-breakpoint
CREATE TABLE "catalog"."resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"type" "catalog"."resource_type" NOT NULL,
	"provider" text NOT NULL,
	"external_id" text,
	"canonical_url" text,
	"title" text NOT NULL,
	"description" text,
	"language" text,
	"visibility" "catalog"."resource_visibility" DEFAULT 'private' NOT NULL,
	"status" "catalog"."resource_status" DEFAULT 'pending' NOT NULL,
	"current_version_id" uuid,
	"quality_score" real,
	"thumbnail_object_key" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "resources_quality_score_chk" CHECK ("catalog"."resources"."quality_score" IS NULL OR ("catalog"."resources"."quality_score" >= 0 AND "catalog"."resources"."quality_score" <= 1))
);
--> statement-breakpoint
CREATE TABLE "study"."learning_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"primary_concept_id" uuid,
	"title" text NOT NULL,
	"intent" text,
	"status" "study"."goal_status" DEFAULT 'active' NOT NULL,
	"starting_level" text,
	"target_level" text,
	"target_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study"."focus_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"study_session_id" uuid,
	"resource_id" uuid,
	"mode" text NOT NULL,
	"planned_duration_sec" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_sec" integer,
	"completed" boolean DEFAULT false NOT NULL,
	"interruption_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "focus_sessions_end_after_start_chk" CHECK ("study"."focus_sessions"."ended_at" IS NULL OR "study"."focus_sessions"."ended_at" >= "study"."focus_sessions"."started_at"),
	CONSTRAINT "focus_sessions_duration_chk" CHECK ("study"."focus_sessions"."duration_sec" IS NULL OR "study"."focus_sessions"."duration_sec" >= 0)
);
--> statement-breakpoint
CREATE TABLE "study"."schedule_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"learning_goal_id" uuid,
	"study_session_id" uuid,
	"concept_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_items_end_after_start_chk" CHECK ("study"."schedule_items"."ends_at" IS NULL OR "study"."schedule_items"."ends_at" >= "study"."schedule_items"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "study"."user_resource_progress" (
	"user_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"last_session_id" uuid,
	"status" text DEFAULT 'not_started' NOT NULL,
	"progress_pct" real,
	"last_anchor" jsonb,
	"last_chunk_id" uuid,
	"first_started_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_resource_progress_user_id_resource_id_pk" PRIMARY KEY("user_id","resource_id"),
	CONSTRAINT "user_resource_progress_pct_chk" CHECK ("study"."user_resource_progress"."progress_pct" IS NULL OR "study"."user_resource_progress"."progress_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "study"."session_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"resource_id" uuid,
	"resource_version_id" uuid,
	"resource_chunk_id" uuid,
	"anchor" jsonb,
	"label" text,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study"."session_context_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_session_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"source_event_id" uuid,
	"context" jsonb NOT NULL,
	"content_sha256" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study"."session_resources" (
	"study_session_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"resource_version_id" uuid NOT NULL,
	"role" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"added_by" text NOT NULL,
	"last_anchor" jsonb,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_opened_at" timestamp with time zone,
	CONSTRAINT "session_resources_study_session_id_resource_id_pk" PRIMARY KEY("study_session_id","resource_id")
);
--> statement-breakpoint
CREATE TABLE "study"."study_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"learning_goal_id" uuid,
	"title" text,
	"mode" "study"."session_mode" NOT NULL,
	"status" "study"."session_status" DEFAULT 'active' NOT NULL,
	"active_resource_id" uuid,
	"active_version_id" uuid,
	"active_chunk_id" uuid,
	"active_anchor" jsonb,
	"context_version" integer DEFAULT 0 NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_sessions_end_after_start_chk" CHECK ("study"."study_sessions"."ended_at" IS NULL OR "study"."study_sessions"."ended_at" >= "study"."study_sessions"."started_at"),
	CONSTRAINT "study_sessions_context_version_chk" CHECK ("study"."study_sessions"."context_version" >= 0),
	CONSTRAINT "study_sessions_lock_version_chk" CHECK ("study"."study_sessions"."lock_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "study"."tutor_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"agent_run_id" uuid,
	"content_text" text,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audio_object_key" text,
	"source_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study"."tutor_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"study_session_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity"."activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_version" smallint NOT NULL,
	"user_id" uuid NOT NULL,
	"study_session_id" uuid,
	"resource_id" uuid,
	"resource_version_id" uuid,
	"resource_chunk_id" uuid,
	"concept_id" uuid,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"source" text NOT NULL,
	"client_event_id" text,
	"idempotency_key" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace_id" text,
	"correlation_id" uuid,
	"causation_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "activity_events_schema_version_chk" CHECK ("activity"."activity_events"."schema_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "retrieval"."chunk_concepts" (
	"chunk_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"confidence" real NOT NULL,
	"source" text NOT NULL,
	"extractor_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunk_concepts_chunk_id_concept_id_relation_type_source_pk" PRIMARY KEY("chunk_id","concept_id","relation_type","source"),
	CONSTRAINT "chunk_concepts_confidence_chk" CHECK ("retrieval"."chunk_concepts"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "retrieval"."resource_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_version_id" uuid NOT NULL,
	"parent_chunk_id" uuid,
	"ordinal" integer NOT NULL,
	"chunk_type" text NOT NULL,
	"heading_path" text[] DEFAULT '{}'::text[] NOT NULL,
	"content" text NOT NULL,
	"content_sha256" char(64) NOT NULL,
	"token_count" integer NOT NULL,
	"language" text,
	"start_ms" integer,
	"end_ms" integer,
	"page_from" integer,
	"page_to" integer,
	"paragraph_from" integer,
	"paragraph_to" integer,
	"anchor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resource_chunks_token_count_chk" CHECK ("retrieval"."resource_chunks"."token_count" > 0),
	CONSTRAINT "resource_chunks_start_ms_chk" CHECK ("retrieval"."resource_chunks"."start_ms" IS NULL OR "retrieval"."resource_chunks"."start_ms" >= 0),
	CONSTRAINT "resource_chunks_end_ms_chk" CHECK ("retrieval"."resource_chunks"."end_ms" IS NULL OR ("retrieval"."resource_chunks"."start_ms" IS NOT NULL AND "retrieval"."resource_chunks"."end_ms" >= "retrieval"."resource_chunks"."start_ms")),
	CONSTRAINT "resource_chunks_page_from_chk" CHECK ("retrieval"."resource_chunks"."page_from" IS NULL OR "retrieval"."resource_chunks"."page_from" >= 1),
	CONSTRAINT "resource_chunks_page_to_chk" CHECK ("retrieval"."resource_chunks"."page_to" IS NULL OR ("retrieval"."resource_chunks"."page_from" IS NOT NULL AND "retrieval"."resource_chunks"."page_to" >= "retrieval"."resource_chunks"."page_from")),
	CONSTRAINT "resource_chunks_paragraph_from_chk" CHECK ("retrieval"."resource_chunks"."paragraph_from" IS NULL OR "retrieval"."resource_chunks"."paragraph_from" >= 1),
	CONSTRAINT "resource_chunks_paragraph_to_chk" CHECK ("retrieval"."resource_chunks"."paragraph_to" IS NULL OR ("retrieval"."resource_chunks"."paragraph_from" IS NOT NULL AND "retrieval"."resource_chunks"."paragraph_to" >= "retrieval"."resource_chunks"."paragraph_from"))
);
--> statement-breakpoint
CREATE TABLE "retrieval"."chunk_embeddings" (
	"chunk_id" uuid NOT NULL,
	"embedding_profile_id" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunk_embeddings_chunk_id_embedding_profile_id_pk" PRIMARY KEY("chunk_id","embedding_profile_id")
);
--> statement-breakpoint
CREATE TABLE "retrieval"."embedding_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model_name" text NOT NULL,
	"dimensions" integer NOT NULL,
	"distance_metric" text DEFAULT 'cosine' NOT NULL,
	"normalization" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	CONSTRAINT "embedding_profiles_dimensions_chk" CHECK ("retrieval"."embedding_profiles"."dimensions" > 0)
);
--> statement-breakpoint
CREATE TABLE "retrieval"."ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"resource_version_id" uuid NOT NULL,
	"pipeline_version" text NOT NULL,
	"status" text NOT NULL,
	"requested_by" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_code" text,
	"failure_detail" text,
	"trace_id" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval"."citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retrieval_run_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"resource_version_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"message_id" uuid,
	"ordinal" integer NOT NULL,
	"anchor_snapshot" jsonb NOT NULL,
	"quote_sha256" char(64),
	"quote_start" integer,
	"quote_end" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval"."retrieval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"study_session_id" uuid,
	"agent_run_id" uuid,
	"query_text" text NOT NULL,
	"query_sha256" char(64) NOT NULL,
	"embedding_profile_id" text,
	"scope" jsonb NOT NULL,
	"strategy_version" text NOT NULL,
	"status" text NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"selected_count" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "retrieval"."retrieved_chunks" (
	"retrieval_run_id" uuid NOT NULL,
	"chunk_id" uuid NOT NULL,
	"candidate_rank" integer NOT NULL,
	"final_rank" integer,
	"lexical_score" real,
	"vector_score" real,
	"rerank_score" real,
	"selected" boolean DEFAULT false NOT NULL,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "retrieved_chunks_retrieval_run_id_chunk_id_pk" PRIMARY KEY("retrieval_run_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "practice"."code_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"sequence_no" integer NOT NULL,
	"kind" text NOT NULL,
	"source_code" text NOT NULL,
	"source_sha256" char(64) NOT NULL,
	"parent_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_snapshots_sequence_no_chk" CHECK ("practice"."code_snapshots"."sequence_no" >= 0)
);
--> statement-breakpoint
CREATE TABLE "practice"."exercise_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"study_session_id" uuid NOT NULL,
	"exercise_binding_id" uuid NOT NULL,
	"exercise_version_id" uuid NOT NULL,
	"status" "practice"."attempt_status" DEFAULT 'started' NOT NULL,
	"language" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_run_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"score" real,
	"passed_case_count" integer,
	"total_case_count" integer,
	"hint_count" integer DEFAULT 0 NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_attempts_score_chk" CHECK ("practice"."exercise_attempts"."score" IS NULL OR "practice"."exercise_attempts"."score" BETWEEN 0 AND 1),
	CONSTRAINT "exercise_attempts_passed_count_chk" CHECK ("practice"."exercise_attempts"."passed_case_count" IS NULL OR "practice"."exercise_attempts"."passed_case_count" >= 0),
	CONSTRAINT "exercise_attempts_total_count_chk" CHECK ("practice"."exercise_attempts"."total_case_count" IS NULL OR "practice"."exercise_attempts"."total_case_count" >= 0),
	CONSTRAINT "exercise_attempts_count_order_chk" CHECK ("practice"."exercise_attempts"."passed_case_count" IS NULL OR "practice"."exercise_attempts"."total_case_count" IS NULL OR "practice"."exercise_attempts"."passed_case_count" <= "practice"."exercise_attempts"."total_case_count"),
	CONSTRAINT "exercise_attempts_counters_chk" CHECK ("practice"."exercise_attempts"."hint_count" >= 0 AND "practice"."exercise_attempts"."submission_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "practice"."execution_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"code_snapshot_id" uuid NOT NULL,
	"test_bundle_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"status" "practice"."execution_status" NOT NULL,
	"runner_pool" text NOT NULL,
	"runtime_image_digest" text NOT NULL,
	"source_sha256" char(64) NOT NULL,
	"test_bundle_sha256" char(64) NOT NULL,
	"cpu_limit_ms" integer NOT NULL,
	"wall_limit_ms" integer NOT NULL,
	"memory_limit_bytes" bigint NOT NULL,
	"exit_code" integer,
	"signal" text,
	"cpu_time_ms" integer,
	"wall_time_ms" integer,
	"peak_memory_bytes" bigint,
	"passed_case_count" integer,
	"total_case_count" integer,
	"stdout_excerpt" text,
	"stderr_excerpt" text,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_runs_limits_chk" CHECK ("practice"."execution_runs"."wall_limit_ms" > 0 AND "practice"."execution_runs"."cpu_limit_ms" > 0 AND "practice"."execution_runs"."memory_limit_bytes" > 0),
	CONSTRAINT "execution_runs_case_counts_chk" CHECK ("practice"."execution_runs"."passed_case_count" IS NULL OR "practice"."execution_runs"."total_case_count" IS NULL OR ("practice"."execution_runs"."passed_case_count" >= 0 AND "practice"."execution_runs"."passed_case_count" <= "practice"."execution_runs"."total_case_count"))
);
--> statement-breakpoint
CREATE TABLE "practice"."observer_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"execution_run_id" uuid,
	"code_snapshot_id" uuid NOT NULL,
	"concept_id" uuid,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"confidence" real NOT NULL,
	"evidence" jsonb NOT NULL,
	"diagnostic_text" text NOT NULL,
	"model_invocation_id" uuid,
	"policy_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "observer_diagnostics_confidence_chk" CHECK ("practice"."observer_diagnostics"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "practice"."test_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_version_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"object_key" text NOT NULL,
	"sha256" char(64) NOT NULL,
	"case_count" integer NOT NULL,
	"runtime_image_digest" text NOT NULL,
	"harness_version" text NOT NULL,
	"resource_limits" jsonb NOT NULL,
	"key_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_bundles_case_count_chk" CHECK ("practice"."test_bundles"."case_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "practice"."exercise_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_version_id" uuid NOT NULL,
	"study_session_id" uuid,
	"resource_id" uuid,
	"resource_version_id" uuid,
	"resource_chunk_id" uuid,
	"concept_id" uuid,
	"start_ms" integer,
	"end_ms" integer,
	"gate_position" integer,
	"required" boolean DEFAULT true NOT NULL,
	"trigger_reason" text,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_bindings_context_chk" CHECK ("practice"."exercise_bindings"."study_session_id" IS NOT NULL OR "practice"."exercise_bindings"."resource_id" IS NOT NULL OR "practice"."exercise_bindings"."resource_chunk_id" IS NOT NULL OR "practice"."exercise_bindings"."concept_id" IS NOT NULL),
	CONSTRAINT "exercise_bindings_time_span_chk" CHECK ("practice"."exercise_bindings"."end_ms" IS NULL OR ("practice"."exercise_bindings"."start_ms" IS NOT NULL AND "practice"."exercise_bindings"."end_ms" >= "practice"."exercise_bindings"."start_ms")),
	CONSTRAINT "exercise_bindings_confidence_chk" CHECK ("practice"."exercise_bindings"."confidence" IS NULL OR "practice"."exercise_bindings"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "practice"."exercise_examples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"input_text" text,
	"expected_output_text" text,
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice"."exercise_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"language" text,
	"runtime_family" text,
	"difficulty" text,
	"prompt_md" text NOT NULL,
	"starter_code" text,
	"function_signature" text,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"solution_outline" text,
	"content_sha256" char(64) NOT NULL,
	"generator_model" text,
	"generator_version" text,
	"validation_status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_versions_version_no_chk" CHECK ("practice"."exercise_versions"."version_no" > 0)
);
--> statement-breakpoint
CREATE TABLE "practice"."exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "practice"."exercise_kind" NOT NULL,
	"canonical_concept_id" uuid,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"owner_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice"."hint_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"diagnostic_id" uuid,
	"hint_level" integer NOT NULL,
	"trigger_type" text NOT NULL,
	"user_requested" boolean NOT NULL,
	"content" text NOT NULL,
	"policy_version" text NOT NULL,
	"model_invocation_id" uuid,
	"presented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "hint_events_level_chk" CHECK ("practice"."hint_events"."hint_level" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "knowledge"."artifact_concepts" (
	"artifact_resource_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"confidence" real NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_concepts_confidence_chk" CHECK ("knowledge"."artifact_concepts"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "knowledge"."artifact_details" (
	"resource_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"study_session_id" uuid,
	"artifact_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"source_agent_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge"."artifact_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_resource_id" uuid NOT NULL,
	"source_resource_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"source_chunk_id" uuid,
	"relation_type" text NOT NULL,
	"anchor" jsonb,
	"confidence" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_sources_confidence_chk" CHECK ("knowledge"."artifact_sources"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "knowledge"."concept_aliases" (
	"concept_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge"."concept_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_concept_id" uuid NOT NULL,
	"target_concept_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"created_by" text NOT NULL,
	"extractor_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_relations_distinct_chk" CHECK ("knowledge"."concept_relations"."source_concept_id" <> "knowledge"."concept_relations"."target_concept_id"),
	CONSTRAINT "concept_relations_weight_chk" CHECK ("knowledge"."concept_relations"."weight" BETWEEN 0 AND 1),
	CONSTRAINT "concept_relations_confidence_chk" CHECK ("knowledge"."concept_relations"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "knowledge"."concepts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'active' NOT NULL,
	"canonical_parent_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(summary, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge"."user_knowledge_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_concept_id" uuid NOT NULL,
	"target_concept_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"weight" real NOT NULL,
	"confidence" real NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_evidence_at" timestamp with time zone NOT NULL,
	"projector_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_knowledge_edges_weight_chk" CHECK ("knowledge"."user_knowledge_edges"."weight" BETWEEN 0 AND 1),
	CONSTRAINT "user_knowledge_edges_confidence_chk" CHECK ("knowledge"."user_knowledge_edges"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "knowledge"."concept_mastery" (
	"user_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"score" real NOT NULL,
	"uncertainty" real NOT NULL,
	"stage" text NOT NULL,
	"evidence_count" integer NOT NULL,
	"positive_evidence" real NOT NULL,
	"negative_evidence" real NOT NULL,
	"last_evidence_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"decay_rate" real,
	"projector_version" text NOT NULL,
	"projection_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concept_mastery_user_id_concept_id_pk" PRIMARY KEY("user_id","concept_id"),
	CONSTRAINT "concept_mastery_score_chk" CHECK ("knowledge"."concept_mastery"."score" BETWEEN 0 AND 1),
	CONSTRAINT "concept_mastery_uncertainty_chk" CHECK ("knowledge"."concept_mastery"."uncertainty" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "knowledge"."mastery_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"study_session_id" uuid,
	"source_event_id" uuid NOT NULL,
	"signal_type" text NOT NULL,
	"value" real NOT NULL,
	"reliability" real NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"projector_version" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mastery_signals_value_chk" CHECK ("knowledge"."mastery_signals"."value" BETWEEN -1 AND 1),
	CONSTRAINT "mastery_signals_reliability_chk" CHECK ("knowledge"."mastery_signals"."reliability" BETWEEN 0 AND 1),
	CONSTRAINT "mastery_signals_weight_chk" CHECK ("knowledge"."mastery_signals"."weight" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "knowledge"."review_schedules" (
	"user_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"algorithm" text NOT NULL,
	"algorithm_version" text NOT NULL,
	"state" jsonb NOT NULL,
	"next_review_at" timestamp with time zone NOT NULL,
	"last_result" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_schedules_user_id_concept_id_pk" PRIMARY KEY("user_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "knowledge"."unresolved_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"study_session_id" uuid NOT NULL,
	"resource_id" uuid,
	"resource_chunk_id" uuid,
	"concept_id" uuid,
	"question" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" smallint DEFAULT 0 NOT NULL,
	"resolved_by_artifact" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent"."agent_artifacts" (
	"agent_run_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_artifacts_agent_run_id_resource_id_role_pk" PRIMARY KEY("agent_run_id","resource_id","role")
);
--> statement-breakpoint
CREATE TABLE "agent"."model_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"agent_step_id" uuid,
	"provider" text NOT NULL,
	"model_name" text NOT NULL,
	"purpose" text NOT NULL,
	"prompt_template_id" text,
	"prompt_template_ver" text,
	"input_sha256" char(64),
	"output_sha256" char(64),
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_tokens" integer,
	"latency_ms" integer,
	"estimated_cost_usd" numeric(18, 8),
	"cache_status" text,
	"safety_status" text,
	"raw_input_object_key" text,
	"raw_output_object_key" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent"."tool_invocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"agent_step_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"tool_version" text,
	"status" text NOT NULL,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"output_object_key" text,
	"latency_ms" integer,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_code" text,
	"failure_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent"."agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"study_session_id" uuid,
	"tutor_thread_id" uuid,
	"purpose" text NOT NULL,
	"status" "agent"."run_status" NOT NULL,
	"goal" text NOT NULL,
	"planner_version" text,
	"policy_version" text NOT NULL,
	"max_iterations" integer NOT NULL,
	"max_tool_calls" integer NOT NULL,
	"max_tokens" integer NOT NULL,
	"trace_id" text,
	"correlation_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_code" text,
	"failure_detail" text,
	"final_answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runs_positive_budgets_chk" CHECK ("agent"."agent_runs"."max_iterations" > 0 AND "agent"."agent_runs"."max_tool_calls" >= 0 AND "agent"."agent_runs"."max_tokens" > 0)
);
--> statement-breakpoint
CREATE TABLE "agent"."agent_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"parent_step_id" uuid,
	"step_key" text NOT NULL,
	"sequence_no" integer NOT NULL,
	"kind" text NOT NULL,
	"status" "agent"."step_status" NOT NULL,
	"depends_on" text[] DEFAULT '{}'::text[] NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_summary" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_code" text,
	"failure_detail" text
);
--> statement-breakpoint
CREATE TABLE "discovery"."resource_quality_snapshots" (
	"resource_id" uuid NOT NULL,
	"feature_version" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"bayesian_engagement" real,
	"comment_quality" real,
	"completion_rate" real,
	"retention_rate" real,
	"freshness_prior" real,
	"content_coverage" real,
	"source_authority" real,
	"final_quality_score" real NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "resource_quality_snapshots_resource_id_feature_version_captured_at_pk" PRIMARY KEY("resource_id","feature_version","captured_at"),
	CONSTRAINT "resource_quality_snapshots_score_chk" CHECK ("discovery"."resource_quality_snapshots"."final_quality_score" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "discovery"."user_concept_affinity" (
	"user_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"score" real NOT NULL,
	"confidence" real NOT NULL,
	"positive_weight" real DEFAULT 0 NOT NULL,
	"negative_weight" real DEFAULT 0 NOT NULL,
	"feature_version" text NOT NULL,
	"last_event_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_concept_affinity_user_id_concept_id_pk" PRIMARY KEY("user_id","concept_id"),
	CONSTRAINT "user_concept_affinity_score_chk" CHECK ("discovery"."user_concept_affinity"."score" BETWEEN -1 AND 1),
	CONSTRAINT "user_concept_affinity_confidence_chk" CHECK ("discovery"."user_concept_affinity"."confidence" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "discovery"."discovery_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"impression_id" uuid,
	"user_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"action" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery"."recommendation_candidates" (
	"recommendation_run_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"candidate_rank" integer NOT NULL,
	"final_rank" integer,
	"score" real NOT NULL,
	"semantic_relevance" real,
	"quality_score" real,
	"learner_affinity" real,
	"mastery_fit" real,
	"coverage_score" real,
	"freshness_score" real,
	"diversity_penalty" real,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	CONSTRAINT "recommendation_candidates_recommendation_run_id_resource_id_pk" PRIMARY KEY("recommendation_run_id","resource_id")
);
--> statement-breakpoint
CREATE TABLE "discovery"."recommendation_impressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"surface" text NOT NULL,
	"shown_at" timestamp with time zone DEFAULT now() NOT NULL,
	"visible_duration_ms" integer,
	"trace_id" text
);
--> statement-breakpoint
CREATE TABLE "discovery"."recommendation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"study_session_id" uuid,
	"surface" text NOT NULL,
	"query_text" text,
	"strategy_version" text NOT NULL,
	"feature_version" text NOT NULL,
	"context_snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ops"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"user_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"trace_id" text,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."backfill_checkpoints" (
	"backfill_name" text NOT NULL,
	"partition_key" text NOT NULL,
	"cursor_value" text,
	"rows_processed" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"last_error" text,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "backfill_checkpoints_backfill_name_partition_key_pk" PRIMARY KEY("backfill_name","partition_key")
);
--> statement-breakpoint
CREATE TABLE "ops"."dead_letter_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"failure_code" text NOT NULL,
	"failure_detail" text NOT NULL,
	"payload" jsonb NOT NULL,
	"first_failed_at" timestamp with time zone NOT NULL,
	"last_failed_at" timestamp with time zone NOT NULL,
	"attempt_count" integer NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	CONSTRAINT "dead_letter_events_attempt_count_chk" CHECK ("ops"."dead_letter_events"."attempt_count" > 0)
);
--> statement-breakpoint
CREATE TABLE "ops"."idempotency_records" (
	"scope" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"user_id" uuid,
	"request_sha256" char(64) NOT NULL,
	"status" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"resource_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_records_scope_idempotency_key_pk" PRIMARY KEY("scope","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "ops"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text NOT NULL,
	"job_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "ops"."job_status" DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"dedup_key" text,
	"idempotency_key" text,
	"correlation_id" uuid,
	"trace_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_detail" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_attempts_chk" CHECK ("ops"."jobs"."attempts" >= 0 AND "ops"."jobs"."max_attempts" > 0 AND "ops"."jobs"."attempts" <= "ops"."jobs"."max_attempts")
);
--> statement-breakpoint
CREATE TABLE "ops"."outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"aggregate_version" integer,
	"event_type" text NOT NULL,
	"schema_version" smallint NOT NULL,
	"user_id" uuid,
	"study_session_id" uuid,
	"payload" jsonb NOT NULL,
	"status" "ops"."outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"last_error" text,
	"trace_id" text,
	"correlation_id" uuid,
	"causation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection"."dashboard_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"active_session_id" uuid,
	"continue_learning" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_research" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mastery_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"focus_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"projection_version" text NOT NULL,
	"source_event_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection"."session_summary" (
	"study_session_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"resource_count" integer NOT NULL,
	"question_count" integer NOT NULL,
	"exercise_count" integer NOT NULL,
	"artifact_count" integer NOT NULL,
	"focus_seconds" integer NOT NULL,
	"concept_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"open_question_count" integer NOT NULL,
	"last_activity_at" timestamp with time zone,
	"projection_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection"."user_learning_daily" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"focused_seconds" integer DEFAULT 0 NOT NULL,
	"resources_opened" integer DEFAULT 0 NOT NULL,
	"resources_completed" integer DEFAULT 0 NOT NULL,
	"questions_asked" integer DEFAULT 0 NOT NULL,
	"exercises_attempted" integer DEFAULT 0 NOT NULL,
	"exercises_completed" integer DEFAULT 0 NOT NULL,
	"concepts_encountered" integer DEFAULT 0 NOT NULL,
	"reviews_completed" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_learning_daily_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "identity"."auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."collection_enrollments" ADD CONSTRAINT "collection_enrollments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."collection_enrollments" ADD CONSTRAINT "collection_enrollments_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "catalog"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."collection_enrollments" ADD CONSTRAINT "collection_enrollments_current_item_id_collection_items_id_fk" FOREIGN KEY ("current_item_id") REFERENCES "catalog"."collection_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."collection_items" ADD CONSTRAINT "collection_items_section_id_collection_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "catalog"."collection_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."collection_items" ADD CONSTRAINT "collection_items_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."collection_sections" ADD CONSTRAINT "collection_sections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "catalog"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."collections" ADD CONSTRAINT "collections_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."resource_concepts" ADD CONSTRAINT "resource_concepts_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."resource_concepts" ADD CONSTRAINT "resource_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."library_items" ADD CONSTRAINT "library_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."library_items" ADD CONSTRAINT "library_items_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."video_details" ADD CONSTRAINT "video_details_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."video_metric_snapshots" ADD CONSTRAINT "video_metric_snapshots_resource_id_video_details_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."video_details"("resource_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."paper_authors" ADD CONSTRAINT "paper_authors_paper_resource_id_paper_details_resource_id_fk" FOREIGN KEY ("paper_resource_id") REFERENCES "catalog"."paper_details"("resource_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."paper_authors" ADD CONSTRAINT "paper_authors_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "catalog"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."paper_details" ADD CONSTRAINT "paper_details_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."paper_references" ADD CONSTRAINT "paper_references_paper_resource_id_paper_details_resource_id_fk" FOREIGN KEY ("paper_resource_id") REFERENCES "catalog"."paper_details"("resource_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."paper_references" ADD CONSTRAINT "paper_references_cited_resource_id_resources_id_fk" FOREIGN KEY ("cited_resource_id") REFERENCES "catalog"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."resource_assets" ADD CONSTRAINT "resource_assets_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."resource_versions" ADD CONSTRAINT "resource_versions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."resources" ADD CONSTRAINT "resources_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."learning_goals" ADD CONSTRAINT "learning_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."learning_goals" ADD CONSTRAINT "learning_goals_primary_concept_id_concepts_id_fk" FOREIGN KEY ("primary_concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."focus_sessions" ADD CONSTRAINT "focus_sessions_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."focus_sessions" ADD CONSTRAINT "focus_sessions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD CONSTRAINT "schedule_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD CONSTRAINT "schedule_items_learning_goal_id_learning_goals_id_fk" FOREIGN KEY ("learning_goal_id") REFERENCES "study"."learning_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD CONSTRAINT "schedule_items_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD CONSTRAINT "schedule_items_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."user_resource_progress" ADD CONSTRAINT "user_resource_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."user_resource_progress" ADD CONSTRAINT "user_resource_progress_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."user_resource_progress" ADD CONSTRAINT "user_resource_progress_last_session_id_study_sessions_id_fk" FOREIGN KEY ("last_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."user_resource_progress" ADD CONSTRAINT "user_resource_progress_last_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("last_chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_checkpoints" ADD CONSTRAINT "session_checkpoints_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_checkpoints" ADD CONSTRAINT "session_checkpoints_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_checkpoints" ADD CONSTRAINT "session_checkpoints_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_checkpoints" ADD CONSTRAINT "session_checkpoints_resource_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("resource_chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_context_snapshots" ADD CONSTRAINT "session_context_snapshots_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_resources" ADD CONSTRAINT "session_resources_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_resources" ADD CONSTRAINT "session_resources_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_resources" ADD CONSTRAINT "session_resources_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_resources" ADD CONSTRAINT "session_resources_resource_version_fkey" FOREIGN KEY ("resource_id","resource_version_id") REFERENCES "catalog"."resource_versions"("resource_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."study_sessions" ADD CONSTRAINT "study_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."study_sessions" ADD CONSTRAINT "study_sessions_learning_goal_id_learning_goals_id_fk" FOREIGN KEY ("learning_goal_id") REFERENCES "study"."learning_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."study_sessions" ADD CONSTRAINT "study_sessions_active_resource_id_resources_id_fk" FOREIGN KEY ("active_resource_id") REFERENCES "catalog"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."study_sessions" ADD CONSTRAINT "study_sessions_active_version_id_resource_versions_id_fk" FOREIGN KEY ("active_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."study_sessions" ADD CONSTRAINT "study_sessions_active_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("active_chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."study_sessions" ADD CONSTRAINT "study_sessions_active_resource_version_fkey" FOREIGN KEY ("active_resource_id","active_version_id") REFERENCES "catalog"."resource_versions"("resource_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."tutor_messages" ADD CONSTRAINT "tutor_messages_thread_id_tutor_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "study"."tutor_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."tutor_threads" ADD CONSTRAINT "tutor_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."tutor_threads" ADD CONSTRAINT "tutor_threads_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_resource_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("resource_chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."chunk_concepts" ADD CONSTRAINT "chunk_concepts_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."chunk_concepts" ADD CONSTRAINT "chunk_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."resource_chunks" ADD CONSTRAINT "resource_chunks_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."chunk_embeddings" ADD CONSTRAINT "chunk_embeddings_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."chunk_embeddings" ADD CONSTRAINT "chunk_embeddings_embedding_profile_id_embedding_profiles_id_fk" FOREIGN KEY ("embedding_profile_id") REFERENCES "retrieval"."embedding_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."ingestion_runs" ADD CONSTRAINT "ingestion_runs_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."ingestion_runs" ADD CONSTRAINT "ingestion_runs_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."citations" ADD CONSTRAINT "citations_retrieval_run_id_retrieval_runs_id_fk" FOREIGN KEY ("retrieval_run_id") REFERENCES "retrieval"."retrieval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."citations" ADD CONSTRAINT "citations_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."citations" ADD CONSTRAINT "citations_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."citations" ADD CONSTRAINT "citations_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."retrieval_runs" ADD CONSTRAINT "retrieval_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."retrieval_runs" ADD CONSTRAINT "retrieval_runs_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."retrieval_runs" ADD CONSTRAINT "retrieval_runs_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."retrieval_runs" ADD CONSTRAINT "retrieval_runs_embedding_profile_id_embedding_profiles_id_fk" FOREIGN KEY ("embedding_profile_id") REFERENCES "retrieval"."embedding_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."retrieved_chunks" ADD CONSTRAINT "retrieved_chunks_retrieval_run_id_retrieval_runs_id_fk" FOREIGN KEY ("retrieval_run_id") REFERENCES "retrieval"."retrieval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."retrieved_chunks" ADD CONSTRAINT "retrieved_chunks_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."code_snapshots" ADD CONSTRAINT "code_snapshots_attempt_id_exercise_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "practice"."exercise_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" ADD CONSTRAINT "exercise_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" ADD CONSTRAINT "exercise_attempts_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" ADD CONSTRAINT "exercise_attempts_exercise_binding_id_exercise_bindings_id_fk" FOREIGN KEY ("exercise_binding_id") REFERENCES "practice"."exercise_bindings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" ADD CONSTRAINT "exercise_attempts_exercise_version_id_exercise_versions_id_fk" FOREIGN KEY ("exercise_version_id") REFERENCES "practice"."exercise_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."execution_runs" ADD CONSTRAINT "execution_runs_attempt_id_exercise_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "practice"."exercise_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."execution_runs" ADD CONSTRAINT "execution_runs_code_snapshot_id_code_snapshots_id_fk" FOREIGN KEY ("code_snapshot_id") REFERENCES "practice"."code_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."execution_runs" ADD CONSTRAINT "execution_runs_test_bundle_id_test_bundles_id_fk" FOREIGN KEY ("test_bundle_id") REFERENCES "practice"."test_bundles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."observer_diagnostics" ADD CONSTRAINT "observer_diagnostics_attempt_id_exercise_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "practice"."exercise_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."observer_diagnostics" ADD CONSTRAINT "observer_diagnostics_execution_run_id_execution_runs_id_fk" FOREIGN KEY ("execution_run_id") REFERENCES "practice"."execution_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."observer_diagnostics" ADD CONSTRAINT "observer_diagnostics_code_snapshot_id_code_snapshots_id_fk" FOREIGN KEY ("code_snapshot_id") REFERENCES "practice"."code_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."observer_diagnostics" ADD CONSTRAINT "observer_diagnostics_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."test_bundles" ADD CONSTRAINT "test_bundles_exercise_version_id_exercise_versions_id_fk" FOREIGN KEY ("exercise_version_id") REFERENCES "practice"."exercise_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" ADD CONSTRAINT "exercise_bindings_exercise_version_id_exercise_versions_id_fk" FOREIGN KEY ("exercise_version_id") REFERENCES "practice"."exercise_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" ADD CONSTRAINT "exercise_bindings_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" ADD CONSTRAINT "exercise_bindings_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" ADD CONSTRAINT "exercise_bindings_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" ADD CONSTRAINT "exercise_bindings_resource_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("resource_chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" ADD CONSTRAINT "exercise_bindings_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_examples" ADD CONSTRAINT "exercise_examples_exercise_version_id_exercise_versions_id_fk" FOREIGN KEY ("exercise_version_id") REFERENCES "practice"."exercise_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_versions" ADD CONSTRAINT "exercise_versions_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "practice"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercises" ADD CONSTRAINT "exercises_canonical_concept_id_concepts_id_fk" FOREIGN KEY ("canonical_concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercises" ADD CONSTRAINT "exercises_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."hint_events" ADD CONSTRAINT "hint_events_attempt_id_exercise_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "practice"."exercise_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."hint_events" ADD CONSTRAINT "hint_events_diagnostic_id_observer_diagnostics_id_fk" FOREIGN KEY ("diagnostic_id") REFERENCES "practice"."observer_diagnostics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_concepts" ADD CONSTRAINT "artifact_concepts_artifact_resource_id_artifact_details_resource_id_fk" FOREIGN KEY ("artifact_resource_id") REFERENCES "knowledge"."artifact_details"("resource_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_concepts" ADD CONSTRAINT "artifact_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_details" ADD CONSTRAINT "artifact_details_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_details" ADD CONSTRAINT "artifact_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_details" ADD CONSTRAINT "artifact_details_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_sources" ADD CONSTRAINT "artifact_sources_artifact_resource_id_artifact_details_resource_id_fk" FOREIGN KEY ("artifact_resource_id") REFERENCES "knowledge"."artifact_details"("resource_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_sources" ADD CONSTRAINT "artifact_sources_source_resource_id_resources_id_fk" FOREIGN KEY ("source_resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_sources" ADD CONSTRAINT "artifact_sources_source_version_id_resource_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_sources" ADD CONSTRAINT "artifact_sources_source_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("source_chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."concept_aliases" ADD CONSTRAINT "concept_aliases_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."concept_relations" ADD CONSTRAINT "concept_relations_source_concept_id_concepts_id_fk" FOREIGN KEY ("source_concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."concept_relations" ADD CONSTRAINT "concept_relations_target_concept_id_concepts_id_fk" FOREIGN KEY ("target_concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."user_knowledge_edges" ADD CONSTRAINT "user_knowledge_edges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."user_knowledge_edges" ADD CONSTRAINT "user_knowledge_edges_source_concept_id_concepts_id_fk" FOREIGN KEY ("source_concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."user_knowledge_edges" ADD CONSTRAINT "user_knowledge_edges_target_concept_id_concepts_id_fk" FOREIGN KEY ("target_concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."concept_mastery" ADD CONSTRAINT "concept_mastery_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."concept_mastery" ADD CONSTRAINT "concept_mastery_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."mastery_signals" ADD CONSTRAINT "mastery_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."mastery_signals" ADD CONSTRAINT "mastery_signals_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."mastery_signals" ADD CONSTRAINT "mastery_signals_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."mastery_signals" ADD CONSTRAINT "mastery_signals_source_event_id_activity_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "activity"."activity_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."review_schedules" ADD CONSTRAINT "review_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."review_schedules" ADD CONSTRAINT "review_schedules_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."unresolved_questions" ADD CONSTRAINT "unresolved_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."unresolved_questions" ADD CONSTRAINT "unresolved_questions_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."unresolved_questions" ADD CONSTRAINT "unresolved_questions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."unresolved_questions" ADD CONSTRAINT "unresolved_questions_resource_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("resource_chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."unresolved_questions" ADD CONSTRAINT "unresolved_questions_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."unresolved_questions" ADD CONSTRAINT "unresolved_questions_resolved_by_artifact_resources_id_fk" FOREIGN KEY ("resolved_by_artifact") REFERENCES "catalog"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_artifacts" ADD CONSTRAINT "agent_artifacts_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_artifacts" ADD CONSTRAINT "agent_artifacts_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."model_invocations" ADD CONSTRAINT "model_invocations_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."model_invocations" ADD CONSTRAINT "model_invocations_agent_step_id_agent_steps_id_fk" FOREIGN KEY ("agent_step_id") REFERENCES "agent"."agent_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."tool_invocations" ADD CONSTRAINT "tool_invocations_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."tool_invocations" ADD CONSTRAINT "tool_invocations_agent_step_id_agent_steps_id_fk" FOREIGN KEY ("agent_step_id") REFERENCES "agent"."agent_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" ADD CONSTRAINT "agent_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" ADD CONSTRAINT "agent_runs_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" ADD CONSTRAINT "agent_runs_tutor_thread_id_tutor_threads_id_fk" FOREIGN KEY ("tutor_thread_id") REFERENCES "study"."tutor_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_steps" ADD CONSTRAINT "agent_steps_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."resource_quality_snapshots" ADD CONSTRAINT "resource_quality_snapshots_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."user_concept_affinity" ADD CONSTRAINT "user_concept_affinity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."user_concept_affinity" ADD CONSTRAINT "user_concept_affinity_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."discovery_interactions" ADD CONSTRAINT "discovery_interactions_impression_id_recommendation_impressions_id_fk" FOREIGN KEY ("impression_id") REFERENCES "discovery"."recommendation_impressions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."discovery_interactions" ADD CONSTRAINT "discovery_interactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."discovery_interactions" ADD CONSTRAINT "discovery_interactions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_candidates" ADD CONSTRAINT "recommendation_candidates_recommendation_run_id_recommendation_runs_id_fk" FOREIGN KEY ("recommendation_run_id") REFERENCES "discovery"."recommendation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_candidates" ADD CONSTRAINT "recommendation_candidates_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_impressions" ADD CONSTRAINT "recommendation_impressions_recommendation_run_id_recommendation_runs_id_fk" FOREIGN KEY ("recommendation_run_id") REFERENCES "discovery"."recommendation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_impressions" ADD CONSTRAINT "recommendation_impressions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_impressions" ADD CONSTRAINT "recommendation_impressions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_runs" ADD CONSTRAINT "recommendation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_runs" ADD CONSTRAINT "recommendation_runs_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection"."dashboard_state" ADD CONSTRAINT "dashboard_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection"."dashboard_state" ADD CONSTRAINT "dashboard_state_active_session_id_study_sessions_id_fk" FOREIGN KEY ("active_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection"."session_summary" ADD CONSTRAINT "session_summary_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection"."session_summary" ADD CONSTRAINT "session_summary_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection"."user_learning_daily" ADD CONSTRAINT "user_learning_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_accounts_provider_account_uq" ON "identity"."auth_accounts" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "identity"."auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_created_idx" ON "identity"."auth_sessions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "auth_sessions_rotation_family_idx" ON "identity"."auth_sessions" USING btree ("rotation_family_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_active_expiry_idx" ON "identity"."auth_sessions" USING btree ("user_id","expires_at") WHERE "identity"."auth_sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_uq" ON "identity"."users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_status_created_idx" ON "identity"."users" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "collection_enrollments_user_updated_idx" ON "catalog"."collection_enrollments" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "collection_items_section_position_uq" ON "catalog"."collection_items" USING btree ("section_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_items_section_resource_uq" ON "catalog"."collection_items" USING btree ("section_id","resource_id");--> statement-breakpoint
CREATE INDEX "collection_items_resource_idx" ON "catalog"."collection_items" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_sections_collection_position_uq" ON "catalog"."collection_sections" USING btree ("collection_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_slug_uq" ON "catalog"."collections" USING btree ("slug") WHERE "catalog"."collections"."slug" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "collections_owner_updated_idx" ON "catalog"."collections" USING btree ("owner_user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "collections_kind_visibility_published_idx" ON "catalog"."collections" USING btree ("kind","visibility","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "resource_concepts_concept_relevance_idx" ON "catalog"."resource_concepts" USING btree ("concept_id","relevance" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "library_items_user_updated_idx" ON "catalog"."library_items" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "video_metric_snapshots_resource_time_idx" ON "catalog"."video_metric_snapshots" USING btree ("resource_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "authors_normalized_name_idx" ON "catalog"."authors" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_authors_paper_ordinal_uq" ON "catalog"."paper_authors" USING btree ("paper_resource_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_references_paper_ordinal_uq" ON "catalog"."paper_references" USING btree ("paper_resource_id","ordinal");--> statement-breakpoint
CREATE INDEX "paper_references_cited_resource_idx" ON "catalog"."paper_references" USING btree ("cited_resource_id");--> statement-breakpoint
CREATE INDEX "paper_references_cited_doi_idx" ON "catalog"."paper_references" USING btree ("cited_doi");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_assets_version_type_ordinal_uq" ON "catalog"."resource_assets" USING btree ("resource_version_id","asset_type","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_assets_object_key_uq" ON "catalog"."resource_assets" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_versions_resource_version_uq" ON "catalog"."resource_versions" USING btree ("resource_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_versions_resource_source_hash_uq" ON "catalog"."resource_versions" USING btree ("resource_id","source_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_provider_external_global_uq" ON "catalog"."resources" USING btree ("provider","external_id") WHERE "catalog"."resources"."owner_user_id" IS NULL AND "catalog"."resources"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "resources_owner_provider_external_uq" ON "catalog"."resources" USING btree ("owner_user_id","provider","external_id") WHERE "catalog"."resources"."owner_user_id" IS NOT NULL AND "catalog"."resources"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "resources_owner_updated_idx" ON "catalog"."resources" USING btree ("owner_user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "resources_type_status_quality_idx" ON "catalog"."resources" USING btree ("type","status","quality_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "resources_visibility_status_idx" ON "catalog"."resources" USING btree ("visibility","status");--> statement-breakpoint
CREATE INDEX "resources_title_trgm_idx" ON "catalog"."resources" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "learning_goals_user_status_updated_idx" ON "study"."learning_goals" USING btree ("user_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "focus_sessions_user_started_idx" ON "study"."focus_sessions" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "focus_sessions_session_started_idx" ON "study"."focus_sessions" USING btree ("study_session_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "schedule_items_user_starts_idx" ON "study"."schedule_items" USING btree ("user_id","starts_at");--> statement-breakpoint
CREATE INDEX "schedule_items_user_status_starts_idx" ON "study"."schedule_items" USING btree ("user_id","status","starts_at");--> statement-breakpoint
CREATE INDEX "user_resource_progress_user_status_updated_idx" ON "study"."user_resource_progress" USING btree ("user_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "session_checkpoints_session_created_idx" ON "study"."session_checkpoints" USING btree ("study_session_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "session_context_snapshots_session_version_uq" ON "study"."session_context_snapshots" USING btree ("study_session_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "session_resources_session_position_uq" ON "study"."session_resources" USING btree ("study_session_id","position");--> statement-breakpoint
CREATE INDEX "study_sessions_user_status_active_idx" ON "study"."study_sessions" USING btree ("user_id","status","last_active_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "study_sessions_goal_active_idx" ON "study"."study_sessions" USING btree ("learning_goal_id","last_active_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "study_sessions_user_active_partial_idx" ON "study"."study_sessions" USING btree ("user_id","last_active_at" DESC NULLS LAST) WHERE "study"."study_sessions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "tutor_messages_thread_created_idx" ON "study"."tutor_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "tutor_threads_session_updated_idx" ON "study"."tutor_threads" USING btree ("study_session_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_events_user_time_idx" ON "activity"."activity_events" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_events_session_time_idx" ON "activity"."activity_events" USING btree ("study_session_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activity_events_resource_type_time_idx" ON "activity"."activity_events" USING btree ("resource_id","event_type","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_events_concept_type_time_idx" ON "activity"."activity_events" USING btree ("concept_id","event_type","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_user_idempotency_uq" ON "activity"."activity_events" USING btree ("user_id","idempotency_key") WHERE "activity"."activity_events"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_source_client_event_uq" ON "activity"."activity_events" USING btree ("source","client_event_id") WHERE "activity"."activity_events"."client_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chunk_concepts_concept_confidence_idx" ON "retrieval"."chunk_concepts" USING btree ("concept_id","confidence" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "resource_chunks_version_ordinal_uq" ON "retrieval"."resource_chunks" USING btree ("resource_version_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_chunks_version_content_ordinal_uq" ON "retrieval"."resource_chunks" USING btree ("resource_version_id","content_sha256","ordinal");--> statement-breakpoint
CREATE INDEX "resource_chunks_version_start_idx" ON "retrieval"."resource_chunks" USING btree ("resource_version_id","start_ms") WHERE "retrieval"."resource_chunks"."start_ms" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "resource_chunks_version_page_idx" ON "retrieval"."resource_chunks" USING btree ("resource_version_id","page_from") WHERE "retrieval"."resource_chunks"."page_from" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "resource_chunks_parent_idx" ON "retrieval"."resource_chunks" USING btree ("parent_chunk_id");--> statement-breakpoint
CREATE INDEX "chunk_embeddings_cosine_hnsw_idx" ON "retrieval"."chunk_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "embedding_profiles_provider_model_dimensions_uq" ON "retrieval"."embedding_profiles" USING btree ("provider","model_name","dimensions");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_runs_version_pipeline_uq" ON "retrieval"."ingestion_runs" USING btree ("resource_version_id","pipeline_version");--> statement-breakpoint
CREATE INDEX "ingestion_runs_status_created_idx" ON "retrieval"."ingestion_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "citations_retrieval_ordinal_uq" ON "retrieval"."citations" USING btree ("retrieval_run_id","ordinal");--> statement-breakpoint
CREATE INDEX "citations_agent_run_idx" ON "retrieval"."citations" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "citations_message_idx" ON "retrieval"."citations" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "retrieval_runs_session_created_idx" ON "retrieval"."retrieval_runs" USING btree ("study_session_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "retrieval_runs_user_created_idx" ON "retrieval"."retrieval_runs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "retrieved_chunks_run_candidate_rank_uq" ON "retrieval"."retrieved_chunks" USING btree ("retrieval_run_id","candidate_rank");--> statement-breakpoint
CREATE UNIQUE INDEX "code_snapshots_attempt_sequence_uq" ON "practice"."code_snapshots" USING btree ("attempt_id","sequence_no");--> statement-breakpoint
CREATE INDEX "code_snapshots_attempt_created_idx" ON "practice"."code_snapshots" USING btree ("attempt_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_attempts_user_idempotency_uq" ON "practice"."exercise_attempts" USING btree ("user_id","idempotency_key") WHERE "practice"."exercise_attempts"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "exercise_attempts_user_created_idx" ON "practice"."exercise_attempts" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "exercise_attempts_session_created_idx" ON "practice"."exercise_attempts" USING btree ("study_session_id","created_at");--> statement-breakpoint
CREATE INDEX "exercise_attempts_version_status_idx" ON "practice"."exercise_attempts" USING btree ("exercise_version_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_runs_request_id_uq" ON "practice"."execution_runs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "execution_runs_attempt_created_idx" ON "practice"."execution_runs" USING btree ("attempt_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "execution_runs_status_created_idx" ON "practice"."execution_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "observer_diagnostics_attempt_created_idx" ON "practice"."observer_diagnostics" USING btree ("attempt_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "test_bundles_version_kind_hash_uq" ON "practice"."test_bundles" USING btree ("exercise_version_id","kind","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "test_bundles_object_key_uq" ON "practice"."test_bundles" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "exercise_bindings_session_gate_idx" ON "practice"."exercise_bindings" USING btree ("study_session_id","gate_position");--> statement-breakpoint
CREATE INDEX "exercise_bindings_resource_start_idx" ON "practice"."exercise_bindings" USING btree ("resource_id","start_ms");--> statement-breakpoint
CREATE INDEX "exercise_bindings_concept_idx" ON "practice"."exercise_bindings" USING btree ("concept_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_examples_version_ordinal_uq" ON "practice"."exercise_examples" USING btree ("exercise_version_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_versions_exercise_version_uq" ON "practice"."exercise_versions" USING btree ("exercise_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_versions_exercise_content_hash_uq" ON "practice"."exercise_versions" USING btree ("exercise_id","content_sha256");--> statement-breakpoint
CREATE INDEX "exercises_concept_status_idx" ON "practice"."exercises" USING btree ("canonical_concept_id","status");--> statement-breakpoint
CREATE INDEX "hint_events_attempt_presented_idx" ON "practice"."hint_events" USING btree ("attempt_id","presented_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_concepts_identity_pk" ON "knowledge"."artifact_concepts" USING btree ("artifact_resource_id","concept_id","relation_type","source");--> statement-breakpoint
CREATE INDEX "artifact_concepts_concept_confidence_idx" ON "knowledge"."artifact_concepts" USING btree ("concept_id","confidence" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "artifact_details_user_updated_idx" ON "knowledge"."artifact_details" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "artifact_details_session_created_idx" ON "knowledge"."artifact_details" USING btree ("study_session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_sources_identity_uq" ON "knowledge"."artifact_sources" USING btree ("artifact_resource_id","source_version_id",coalesce("source_chunk_id", '00000000-0000-0000-0000-000000000000'::uuid),"relation_type");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_aliases_identity_pk" ON "knowledge"."concept_aliases" USING btree ("concept_id","normalized_alias","locale");--> statement-breakpoint
CREATE INDEX "concept_aliases_normalized_idx" ON "knowledge"."concept_aliases" USING btree ("normalized_alias");--> statement-breakpoint
CREATE UNIQUE INDEX "concept_relations_identity_uq" ON "knowledge"."concept_relations" USING btree ("source_concept_id","target_concept_id","relation_type");--> statement-breakpoint
CREATE UNIQUE INDEX "concepts_slug_uq" ON "knowledge"."concepts" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "concepts_kind_status_idx" ON "knowledge"."concepts" USING btree ("kind","status");--> statement-breakpoint
CREATE INDEX "concepts_parent_idx" ON "knowledge"."concepts" USING btree ("canonical_parent_id");--> statement-breakpoint
CREATE INDEX "concepts_name_trgm_idx" ON "knowledge"."concepts" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "user_knowledge_edges_identity_uq" ON "knowledge"."user_knowledge_edges" USING btree ("user_id","source_concept_id","target_concept_id","relation_type");--> statement-breakpoint
CREATE INDEX "concept_mastery_user_next_review_idx" ON "knowledge"."concept_mastery" USING btree ("user_id","next_review_at") WHERE "knowledge"."concept_mastery"."next_review_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "concept_mastery_user_score_uncertainty_idx" ON "knowledge"."concept_mastery" USING btree ("user_id","score","uncertainty");--> statement-breakpoint
CREATE UNIQUE INDEX "mastery_signals_identity_uq" ON "knowledge"."mastery_signals" USING btree ("user_id","concept_id","source_event_id","signal_type");--> statement-breakpoint
CREATE INDEX "mastery_signals_user_concept_observed_idx" ON "knowledge"."mastery_signals" USING btree ("user_id","concept_id","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mastery_signals_source_event_idx" ON "knowledge"."mastery_signals" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "review_schedules_user_next_review_idx" ON "knowledge"."review_schedules" USING btree ("user_id","next_review_at");--> statement-breakpoint
CREATE INDEX "unresolved_questions_user_status_updated_idx" ON "knowledge"."unresolved_questions" USING btree ("user_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "unresolved_questions_session_status_idx" ON "knowledge"."unresolved_questions" USING btree ("study_session_id","status");--> statement-breakpoint
CREATE INDEX "model_invocations_run_created_idx" ON "agent"."model_invocations" USING btree ("agent_run_id","created_at");--> statement-breakpoint
CREATE INDEX "model_invocations_provider_model_created_idx" ON "agent"."model_invocations" USING btree ("provider","model_name","created_at");--> statement-breakpoint
CREATE INDEX "tool_invocations_run_created_idx" ON "agent"."tool_invocations" USING btree ("agent_run_id","created_at");--> statement-breakpoint
CREATE INDEX "tool_invocations_name_status_created_idx" ON "agent"."tool_invocations" USING btree ("tool_name","status","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_user_created_idx" ON "agent"."agent_runs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_runs_session_created_idx" ON "agent"."agent_runs" USING btree ("study_session_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_runs_status_created_idx" ON "agent"."agent_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_steps_run_key_uq" ON "agent"."agent_steps" USING btree ("agent_run_id","step_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_steps_run_sequence_uq" ON "agent"."agent_steps" USING btree ("agent_run_id","sequence_no");--> statement-breakpoint
CREATE INDEX "agent_steps_run_status_idx" ON "agent"."agent_steps" USING btree ("agent_run_id","status");--> statement-breakpoint
CREATE INDEX "resource_quality_snapshots_version_score_idx" ON "discovery"."resource_quality_snapshots" USING btree ("feature_version","final_quality_score" DESC NULLS LAST,"captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "user_concept_affinity_user_score_idx" ON "discovery"."user_concept_affinity" USING btree ("user_id","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "discovery_interactions_user_occurred_idx" ON "discovery"."discovery_interactions" USING btree ("user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "discovery_interactions_resource_action_occurred_idx" ON "discovery"."discovery_interactions" USING btree ("resource_id","action","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_candidates_run_candidate_rank_uq" ON "discovery"."recommendation_candidates" USING btree ("recommendation_run_id","candidate_rank");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_candidates_run_final_rank_uq" ON "discovery"."recommendation_candidates" USING btree ("recommendation_run_id","final_rank") WHERE "discovery"."recommendation_candidates"."final_rank" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_impressions_run_resource_position_uq" ON "discovery"."recommendation_impressions" USING btree ("recommendation_run_id","resource_id","position");--> statement-breakpoint
CREATE INDEX "recommendation_impressions_user_shown_idx" ON "discovery"."recommendation_impressions" USING btree ("user_id","shown_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "recommendation_runs_user_created_idx" ON "discovery"."recommendation_runs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "recommendation_runs_surface_created_idx" ON "discovery"."recommendation_runs" USING btree ("surface","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_entity_created_idx" ON "ops"."audit_log" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_user_created_idx" ON "ops"."audit_log" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "dead_letter_events_resolution_idx" ON "ops"."dead_letter_events" USING btree ("resolved_at","last_failed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idempotency_records_expires_idx" ON "ops"."idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "ops"."jobs" USING btree ("queue","priority" DESC NULLS LAST,"available_at","created_at") WHERE "ops"."jobs"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_active_dedup_uq" ON "ops"."jobs" USING btree ("queue","dedup_key") WHERE "ops"."jobs"."dedup_key" IS NOT NULL AND "ops"."jobs"."status" IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX "jobs_running_lease_idx" ON "ops"."jobs" USING btree ("status","lease_expires_at") WHERE "ops"."jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "jobs_correlation_idx" ON "ops"."jobs" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "outbox_events_publish_idx" ON "ops"."outbox_events" USING btree ("available_at","created_at") WHERE "ops"."outbox_events"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "ops"."outbox_events" USING btree ("aggregate_type","aggregate_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_correlation_idx" ON "ops"."outbox_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "session_summary_user_activity_idx" ON "projection"."session_summary" USING btree ("user_id","last_activity_at" DESC NULLS LAST);
