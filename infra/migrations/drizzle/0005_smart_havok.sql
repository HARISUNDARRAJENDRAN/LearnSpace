ALTER TABLE "catalog"."collection_enrollments" DROP CONSTRAINT "collection_enrollments_collection_id_collections_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."collection_enrollments" DROP CONSTRAINT "collection_enrollments_current_item_id_collection_items_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."collection_items" DROP CONSTRAINT "collection_items_section_id_collection_sections_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."collection_sections" DROP CONSTRAINT "collection_sections_collection_id_collections_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."collections" DROP CONSTRAINT "collections_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."resource_concepts" DROP CONSTRAINT "resource_concepts_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."resource_concepts" DROP CONSTRAINT "resource_concepts_concept_id_concepts_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."library_items" DROP CONSTRAINT "library_items_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."library_items" DROP CONSTRAINT "library_items_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."video_details" DROP CONSTRAINT "video_details_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."video_metric_snapshots" DROP CONSTRAINT "video_metric_snapshots_resource_id_video_details_resource_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."paper_authors" DROP CONSTRAINT "paper_authors_paper_resource_id_paper_details_resource_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."paper_details" DROP CONSTRAINT "paper_details_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."paper_references" DROP CONSTRAINT "paper_references_paper_resource_id_paper_details_resource_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."resource_assets" DROP CONSTRAINT "resource_assets_resource_version_id_resource_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."resource_versions" DROP CONSTRAINT "resource_versions_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog"."resources" DROP CONSTRAINT "resources_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."learning_goals" DROP CONSTRAINT "learning_goals_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."focus_sessions" DROP CONSTRAINT "focus_sessions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."focus_sessions" DROP CONSTRAINT "focus_sessions_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."focus_sessions" DROP CONSTRAINT "focus_sessions_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."schedule_items" DROP CONSTRAINT "schedule_items_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."schedule_items" DROP CONSTRAINT "schedule_items_learning_goal_id_learning_goals_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."schedule_items" DROP CONSTRAINT "schedule_items_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."user_resource_progress" DROP CONSTRAINT "user_resource_progress_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."user_resource_progress" DROP CONSTRAINT "user_resource_progress_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."user_resource_progress" DROP CONSTRAINT "user_resource_progress_last_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."user_resource_progress" DROP CONSTRAINT "user_resource_progress_last_chunk_id_resource_chunks_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."session_checkpoints" DROP CONSTRAINT "session_checkpoints_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."session_context_snapshots" DROP CONSTRAINT "session_context_snapshots_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."session_resources" DROP CONSTRAINT "session_resources_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."study_sessions" DROP CONSTRAINT "study_sessions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."study_sessions" DROP CONSTRAINT "study_sessions_learning_goal_id_learning_goals_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."study_sessions" DROP CONSTRAINT "study_sessions_active_resource_version_fkey";
--> statement-breakpoint
ALTER TABLE "study"."study_sessions" DROP CONSTRAINT "study_sessions_active_version_chunk_fkey";
--> statement-breakpoint
ALTER TABLE "study"."tutor_messages" DROP CONSTRAINT "tutor_messages_thread_id_tutor_threads_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."tutor_threads" DROP CONSTRAINT "tutor_threads_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."tutor_threads" DROP CONSTRAINT "tutor_threads_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."tutor_threads" DROP CONSTRAINT "tutor_threads_user_session_fkey";
--> statement-breakpoint
ALTER TABLE "activity"."activity_events" DROP CONSTRAINT "activity_events_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "activity"."activity_events" DROP CONSTRAINT "activity_events_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "activity"."activity_events" DROP CONSTRAINT "activity_events_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "activity"."activity_events" DROP CONSTRAINT "activity_events_resource_version_id_resource_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "activity"."activity_events" DROP CONSTRAINT "activity_events_resource_chunk_id_resource_chunks_id_fk";
--> statement-breakpoint
ALTER TABLE "activity"."activity_events" DROP CONSTRAINT "activity_events_user_session_fkey";
--> statement-breakpoint
ALTER TABLE "activity"."activity_events" DROP CONSTRAINT "activity_events_session_resource_fkey";
--> statement-breakpoint
ALTER TABLE "activity"."activity_events" DROP CONSTRAINT "activity_events_resource_version_fkey";
--> statement-breakpoint
ALTER TABLE "activity"."activity_events" DROP CONSTRAINT "activity_events_version_chunk_fkey";
--> statement-breakpoint
ALTER TABLE "retrieval"."resource_chunks" DROP CONSTRAINT "resource_chunks_resource_version_id_resource_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "retrieval"."ingestion_runs" DROP CONSTRAINT "ingestion_runs_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "retrieval"."ingestion_runs" DROP CONSTRAINT "ingestion_runs_resource_version_id_resource_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "retrieval"."citations" DROP CONSTRAINT "citations_retrieval_run_id_retrieval_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "retrieval"."citations" DROP CONSTRAINT "citations_agent_run_id_agent_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "retrieval"."citations" DROP CONSTRAINT "citations_retrieved_chunk_fkey";
--> statement-breakpoint
ALTER TABLE "retrieval"."retrieval_runs" DROP CONSTRAINT "retrieval_runs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "retrieval"."retrieval_runs" DROP CONSTRAINT "retrieval_runs_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "retrieval"."retrieval_runs" DROP CONSTRAINT "retrieval_runs_agent_run_id_agent_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "retrieval"."retrieval_runs" DROP CONSTRAINT "retrieval_runs_user_session_fkey";
--> statement-breakpoint
ALTER TABLE "retrieval"."retrieved_chunks" DROP CONSTRAINT "retrieved_chunks_retrieval_run_id_retrieval_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "retrieval"."retrieved_chunks" DROP CONSTRAINT "retrieved_chunks_chunk_id_resource_chunks_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."code_snapshots" DROP CONSTRAINT "code_snapshots_attempt_id_exercise_attempts_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" DROP CONSTRAINT "exercise_attempts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" DROP CONSTRAINT "exercise_attempts_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" DROP CONSTRAINT "exercise_attempts_user_session_fkey";
--> statement-breakpoint
ALTER TABLE "practice"."execution_runs" DROP CONSTRAINT "execution_runs_attempt_id_exercise_attempts_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."observer_diagnostics" DROP CONSTRAINT "observer_diagnostics_attempt_id_exercise_attempts_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."test_bundles" DROP CONSTRAINT "test_bundles_exercise_version_id_exercise_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" DROP CONSTRAINT "exercise_bindings_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" DROP CONSTRAINT "exercise_bindings_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" DROP CONSTRAINT "exercise_bindings_resource_version_id_resource_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" DROP CONSTRAINT "exercise_bindings_resource_chunk_id_resource_chunks_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" DROP CONSTRAINT "exercise_bindings_resource_version_fkey";
--> statement-breakpoint
ALTER TABLE "practice"."exercise_examples" DROP CONSTRAINT "exercise_examples_exercise_version_id_exercise_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."exercise_versions" DROP CONSTRAINT "exercise_versions_exercise_id_exercises_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."exercises" DROP CONSTRAINT "exercises_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."hint_events" DROP CONSTRAINT "hint_events_attempt_id_exercise_attempts_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_concepts" DROP CONSTRAINT "artifact_concepts_artifact_fkey";
--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_details" DROP CONSTRAINT "artifact_details_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_details" DROP CONSTRAINT "artifact_details_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_details" DROP CONSTRAINT "artifact_details_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_sources" DROP CONSTRAINT "artifact_sources_source_chunk_id_resource_chunks_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_sources" DROP CONSTRAINT "artifact_sources_artifact_fkey";
--> statement-breakpoint
ALTER TABLE "knowledge"."concept_mastery" DROP CONSTRAINT "concept_mastery_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge"."concept_mastery" DROP CONSTRAINT "concept_mastery_concept_id_concepts_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge"."mastery_signals" DROP CONSTRAINT "mastery_signals_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge"."mastery_signals" DROP CONSTRAINT "mastery_signals_concept_id_concepts_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge"."mastery_signals" DROP CONSTRAINT "mastery_signals_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge"."review_schedules" DROP CONSTRAINT "review_schedules_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge"."review_schedules" DROP CONSTRAINT "review_schedules_concept_id_concepts_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge"."unresolved_questions" DROP CONSTRAINT "unresolved_questions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "knowledge"."unresolved_questions" DROP CONSTRAINT "unresolved_questions_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "agent"."agent_artifacts" DROP CONSTRAINT "agent_artifacts_agent_run_id_agent_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "agent"."agent_artifacts" DROP CONSTRAINT "agent_artifacts_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "agent"."model_invocations" DROP CONSTRAINT "model_invocations_agent_run_id_agent_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "agent"."model_invocations" DROP CONSTRAINT "model_invocations_agent_step_id_agent_steps_id_fk";
--> statement-breakpoint
ALTER TABLE "agent"."tool_invocations" DROP CONSTRAINT "tool_invocations_agent_run_id_agent_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "agent"."tool_invocations" DROP CONSTRAINT "tool_invocations_agent_step_id_agent_steps_id_fk";
--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" DROP CONSTRAINT "agent_runs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" DROP CONSTRAINT "agent_runs_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" DROP CONSTRAINT "agent_runs_tutor_thread_id_tutor_threads_id_fk";
--> statement-breakpoint
ALTER TABLE "agent"."agent_steps" DROP CONSTRAINT "agent_steps_agent_run_id_agent_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "discovery"."discovery_interactions" DROP CONSTRAINT "discovery_interactions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "discovery"."discovery_interactions" DROP CONSTRAINT "discovery_interactions_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "discovery"."discovery_interactions" DROP CONSTRAINT "discovery_interactions_impression_fkey";
--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_candidates" DROP CONSTRAINT "recommendation_candidates_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_candidates" DROP CONSTRAINT "recommendation_candidates_run_fkey";
--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_impressions" DROP CONSTRAINT "recommendation_impressions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_impressions" DROP CONSTRAINT "recommendation_impressions_resource_id_resources_id_fk";
--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_impressions" DROP CONSTRAINT "recommendation_impressions_run_fkey";
--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_runs" DROP CONSTRAINT "recommendation_runs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_runs" DROP CONSTRAINT "recommendation_runs_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_runs_id_agent_run_uq" ON "retrieval"."retrieval_runs" USING btree ("id","agent_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_impressions_id_user_resource_uq" ON "discovery"."recommendation_impressions" USING btree ("id","user_id","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recommendation_runs_user_id_uq" ON "discovery"."recommendation_runs" USING btree ("user_id","id");--> statement-breakpoint
ALTER TABLE "study"."tutor_threads" ADD CONSTRAINT "tutor_threads_user_id_uq" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "study"."tutor_threads" ADD CONSTRAINT "tutor_threads_id_session_uq" UNIQUE("id","study_session_id");--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_user_id_uq" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_user_session_id_uq" UNIQUE("user_id","study_session_id","id");--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" ADD CONSTRAINT "agent_runs_user_id_uq" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" ADD CONSTRAINT "agent_runs_id_session_uq" UNIQUE("id","study_session_id");--> statement-breakpoint
ALTER TABLE "agent"."agent_steps" ADD CONSTRAINT "agent_steps_run_id_uq" UNIQUE("agent_run_id","id");--> statement-breakpoint
ALTER TABLE "catalog"."collection_enrollments" ADD CONSTRAINT "collection_enrollments_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "catalog"."collections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."collection_enrollments" ADD CONSTRAINT "collection_enrollments_current_item_id_collection_items_id_fk" FOREIGN KEY ("current_item_id") REFERENCES "catalog"."collection_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."collection_items" ADD CONSTRAINT "collection_items_section_id_collection_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "catalog"."collection_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."collection_sections" ADD CONSTRAINT "collection_sections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "catalog"."collections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."collections" ADD CONSTRAINT "collections_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."resource_concepts" ADD CONSTRAINT "resource_concepts_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."resource_concepts" ADD CONSTRAINT "resource_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."library_items" ADD CONSTRAINT "library_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."library_items" ADD CONSTRAINT "library_items_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."video_details" ADD CONSTRAINT "video_details_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."video_metric_snapshots" ADD CONSTRAINT "video_metric_snapshots_resource_id_video_details_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."video_details"("resource_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."paper_authors" ADD CONSTRAINT "paper_authors_paper_resource_id_paper_details_resource_id_fk" FOREIGN KEY ("paper_resource_id") REFERENCES "catalog"."paper_details"("resource_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."paper_details" ADD CONSTRAINT "paper_details_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."paper_references" ADD CONSTRAINT "paper_references_paper_resource_id_paper_details_resource_id_fk" FOREIGN KEY ("paper_resource_id") REFERENCES "catalog"."paper_details"("resource_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."resource_assets" ADD CONSTRAINT "resource_assets_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."resource_versions" ADD CONSTRAINT "resource_versions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."resources" ADD CONSTRAINT "resources_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."learning_goals" ADD CONSTRAINT "learning_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."focus_sessions" ADD CONSTRAINT "focus_sessions_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."focus_sessions" ADD CONSTRAINT "focus_sessions_session_resource_fkey" FOREIGN KEY ("study_session_id","resource_id") REFERENCES "study"."session_resources"("study_session_id","resource_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."focus_sessions" ADD CONSTRAINT "focus_sessions_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."focus_sessions" ADD CONSTRAINT "focus_sessions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD CONSTRAINT "schedule_items_user_goal_fkey" FOREIGN KEY ("user_id","learning_goal_id") REFERENCES "study"."learning_goals"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD CONSTRAINT "schedule_items_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD CONSTRAINT "schedule_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD CONSTRAINT "schedule_items_learning_goal_id_learning_goals_id_fk" FOREIGN KEY ("learning_goal_id") REFERENCES "study"."learning_goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."schedule_items" ADD CONSTRAINT "schedule_items_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."user_resource_progress" ADD CONSTRAINT "user_resource_progress_user_session_fkey" FOREIGN KEY ("user_id","last_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."user_resource_progress" ADD CONSTRAINT "user_resource_progress_session_resource_fkey" FOREIGN KEY ("last_session_id","resource_id") REFERENCES "study"."session_resources"("study_session_id","resource_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."user_resource_progress" ADD CONSTRAINT "user_resource_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."user_resource_progress" ADD CONSTRAINT "user_resource_progress_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."user_resource_progress" ADD CONSTRAINT "user_resource_progress_last_session_id_study_sessions_id_fk" FOREIGN KEY ("last_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."user_resource_progress" ADD CONSTRAINT "user_resource_progress_last_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("last_chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_checkpoints" ADD CONSTRAINT "session_checkpoints_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_context_snapshots" ADD CONSTRAINT "session_context_snapshots_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."session_resources" ADD CONSTRAINT "session_resources_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."study_sessions" ADD CONSTRAINT "study_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."study_sessions" ADD CONSTRAINT "study_sessions_learning_goal_id_learning_goals_id_fk" FOREIGN KEY ("learning_goal_id") REFERENCES "study"."learning_goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."study_sessions" ADD CONSTRAINT "study_sessions_active_resource_version_fkey" FOREIGN KEY ("active_resource_id","active_version_id") REFERENCES "catalog"."resource_versions"("resource_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."study_sessions" ADD CONSTRAINT "study_sessions_active_version_chunk_fkey" FOREIGN KEY ("active_version_id","active_chunk_id") REFERENCES "retrieval"."resource_chunks"("resource_version_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."tutor_messages" ADD CONSTRAINT "tutor_messages_thread_id_tutor_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "study"."tutor_threads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."tutor_threads" ADD CONSTRAINT "tutor_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."tutor_threads" ADD CONSTRAINT "tutor_threads_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study"."tutor_threads" ADD CONSTRAINT "tutor_threads_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_resource_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("resource_chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_session_resource_fkey" FOREIGN KEY ("study_session_id","resource_id") REFERENCES "study"."session_resources"("study_session_id","resource_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_resource_version_fkey" FOREIGN KEY ("resource_id","resource_version_id") REFERENCES "catalog"."resource_versions"("resource_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity"."activity_events" ADD CONSTRAINT "activity_events_version_chunk_fkey" FOREIGN KEY ("resource_version_id","resource_chunk_id") REFERENCES "retrieval"."resource_chunks"("resource_version_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."resource_chunks" ADD CONSTRAINT "resource_chunks_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."ingestion_runs" ADD CONSTRAINT "ingestion_runs_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."ingestion_runs" ADD CONSTRAINT "ingestion_runs_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."citations" ADD CONSTRAINT "citations_retrieval_run_id_retrieval_runs_id_fk" FOREIGN KEY ("retrieval_run_id") REFERENCES "retrieval"."retrieval_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."citations" ADD CONSTRAINT "citations_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."citations" ADD CONSTRAINT "citations_retrieved_chunk_fkey" FOREIGN KEY ("retrieval_run_id","chunk_id") REFERENCES "retrieval"."retrieved_chunks"("retrieval_run_id","chunk_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."retrieval_runs" ADD CONSTRAINT "retrieval_runs_user_agent_run_fkey" FOREIGN KEY ("user_id","agent_run_id") REFERENCES "agent"."agent_runs"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."retrieval_runs" ADD CONSTRAINT "retrieval_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."retrieval_runs" ADD CONSTRAINT "retrieval_runs_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."retrieval_runs" ADD CONSTRAINT "retrieval_runs_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."retrieval_runs" ADD CONSTRAINT "retrieval_runs_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."retrieved_chunks" ADD CONSTRAINT "retrieved_chunks_retrieval_run_id_retrieval_runs_id_fk" FOREIGN KEY ("retrieval_run_id") REFERENCES "retrieval"."retrieval_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval"."retrieved_chunks" ADD CONSTRAINT "retrieved_chunks_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."code_snapshots" ADD CONSTRAINT "code_snapshots_attempt_id_exercise_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "practice"."exercise_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" ADD CONSTRAINT "exercise_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" ADD CONSTRAINT "exercise_attempts_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_attempts" ADD CONSTRAINT "exercise_attempts_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."execution_runs" ADD CONSTRAINT "execution_runs_attempt_id_exercise_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "practice"."exercise_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."observer_diagnostics" ADD CONSTRAINT "observer_diagnostics_attempt_id_exercise_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "practice"."exercise_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."test_bundles" ADD CONSTRAINT "test_bundles_exercise_version_id_exercise_versions_id_fk" FOREIGN KEY ("exercise_version_id") REFERENCES "practice"."exercise_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" ADD CONSTRAINT "exercise_bindings_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" ADD CONSTRAINT "exercise_bindings_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" ADD CONSTRAINT "exercise_bindings_resource_version_id_resource_versions_id_fk" FOREIGN KEY ("resource_version_id") REFERENCES "catalog"."resource_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" ADD CONSTRAINT "exercise_bindings_resource_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("resource_chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" ADD CONSTRAINT "exercise_bindings_resource_version_fkey" FOREIGN KEY ("resource_id","resource_version_id") REFERENCES "catalog"."resource_versions"("resource_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_examples" ADD CONSTRAINT "exercise_examples_exercise_version_id_exercise_versions_id_fk" FOREIGN KEY ("exercise_version_id") REFERENCES "practice"."exercise_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercise_versions" ADD CONSTRAINT "exercise_versions_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "practice"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."exercises" ADD CONSTRAINT "exercises_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice"."hint_events" ADD CONSTRAINT "hint_events_attempt_id_exercise_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "practice"."exercise_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_concepts" ADD CONSTRAINT "artifact_concepts_artifact_fkey" FOREIGN KEY ("artifact_resource_id") REFERENCES "knowledge"."artifact_details"("resource_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_details" ADD CONSTRAINT "artifact_details_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_details" ADD CONSTRAINT "artifact_details_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_details" ADD CONSTRAINT "artifact_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_details" ADD CONSTRAINT "artifact_details_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_sources" ADD CONSTRAINT "artifact_sources_resource_version_fkey" FOREIGN KEY ("source_resource_id","source_version_id") REFERENCES "catalog"."resource_versions"("resource_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_sources" ADD CONSTRAINT "artifact_sources_version_chunk_fkey" FOREIGN KEY ("source_version_id","source_chunk_id") REFERENCES "retrieval"."resource_chunks"("resource_version_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_sources" ADD CONSTRAINT "artifact_sources_source_chunk_id_resource_chunks_id_fk" FOREIGN KEY ("source_chunk_id") REFERENCES "retrieval"."resource_chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_sources" ADD CONSTRAINT "artifact_sources_artifact_fkey" FOREIGN KEY ("artifact_resource_id") REFERENCES "knowledge"."artifact_details"("resource_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."concept_mastery" ADD CONSTRAINT "concept_mastery_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."concept_mastery" ADD CONSTRAINT "concept_mastery_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."mastery_signals" ADD CONSTRAINT "mastery_signals_user_source_event_fkey" FOREIGN KEY ("user_id","source_event_id") REFERENCES "activity"."activity_events"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."mastery_signals" ADD CONSTRAINT "mastery_signals_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."mastery_signals" ADD CONSTRAINT "mastery_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."mastery_signals" ADD CONSTRAINT "mastery_signals_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."mastery_signals" ADD CONSTRAINT "mastery_signals_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."review_schedules" ADD CONSTRAINT "review_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."review_schedules" ADD CONSTRAINT "review_schedules_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "knowledge"."concepts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."unresolved_questions" ADD CONSTRAINT "unresolved_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge"."unresolved_questions" ADD CONSTRAINT "unresolved_questions_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_artifacts" ADD CONSTRAINT "agent_artifacts_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_artifacts" ADD CONSTRAINT "agent_artifacts_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."model_invocations" ADD CONSTRAINT "model_invocations_run_step_fkey" FOREIGN KEY ("agent_run_id","agent_step_id") REFERENCES "agent"."agent_steps"("agent_run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."model_invocations" ADD CONSTRAINT "model_invocations_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."model_invocations" ADD CONSTRAINT "model_invocations_agent_step_id_agent_steps_id_fk" FOREIGN KEY ("agent_step_id") REFERENCES "agent"."agent_steps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."tool_invocations" ADD CONSTRAINT "tool_invocations_run_step_fkey" FOREIGN KEY ("agent_run_id","agent_step_id") REFERENCES "agent"."agent_steps"("agent_run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."tool_invocations" ADD CONSTRAINT "tool_invocations_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."tool_invocations" ADD CONSTRAINT "tool_invocations_agent_step_id_agent_steps_id_fk" FOREIGN KEY ("agent_step_id") REFERENCES "agent"."agent_steps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" ADD CONSTRAINT "agent_runs_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" ADD CONSTRAINT "agent_runs_user_thread_fkey" FOREIGN KEY ("user_id","tutor_thread_id") REFERENCES "study"."tutor_threads"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" ADD CONSTRAINT "agent_runs_thread_session_fkey" FOREIGN KEY ("tutor_thread_id","study_session_id") REFERENCES "study"."tutor_threads"("id","study_session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" ADD CONSTRAINT "agent_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" ADD CONSTRAINT "agent_runs_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" ADD CONSTRAINT "agent_runs_tutor_thread_id_tutor_threads_id_fk" FOREIGN KEY ("tutor_thread_id") REFERENCES "study"."tutor_threads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_steps" ADD CONSTRAINT "agent_steps_parent_run_fkey" FOREIGN KEY ("agent_run_id","parent_step_id") REFERENCES "agent"."agent_steps"("agent_run_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_steps" ADD CONSTRAINT "agent_steps_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "agent"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."discovery_interactions" ADD CONSTRAINT "discovery_interactions_impression_context_fkey" FOREIGN KEY ("impression_id","user_id","resource_id") REFERENCES "discovery"."recommendation_impressions"("id","user_id","resource_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."discovery_interactions" ADD CONSTRAINT "discovery_interactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."discovery_interactions" ADD CONSTRAINT "discovery_interactions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."discovery_interactions" ADD CONSTRAINT "discovery_interactions_impression_fkey" FOREIGN KEY ("impression_id") REFERENCES "discovery"."recommendation_impressions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_candidates" ADD CONSTRAINT "recommendation_candidates_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_candidates" ADD CONSTRAINT "recommendation_candidates_run_fkey" FOREIGN KEY ("recommendation_run_id") REFERENCES "discovery"."recommendation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_impressions" ADD CONSTRAINT "recommendation_impressions_run_user_fkey" FOREIGN KEY ("recommendation_run_id","user_id") REFERENCES "discovery"."recommendation_runs"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_impressions" ADD CONSTRAINT "recommendation_impressions_run_resource_fkey" FOREIGN KEY ("recommendation_run_id","resource_id") REFERENCES "discovery"."recommendation_candidates"("recommendation_run_id","resource_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_impressions" ADD CONSTRAINT "recommendation_impressions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_impressions" ADD CONSTRAINT "recommendation_impressions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "catalog"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_impressions" ADD CONSTRAINT "recommendation_impressions_run_fkey" FOREIGN KEY ("recommendation_run_id") REFERENCES "discovery"."recommendation_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_runs" ADD CONSTRAINT "recommendation_runs_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_runs" ADD CONSTRAINT "recommendation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery"."recommendation_runs" ADD CONSTRAINT "recommendation_runs_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."outbox_events" ADD CONSTRAINT "outbox_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."outbox_events" ADD CONSTRAINT "outbox_events_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."outbox_events" ADD CONSTRAINT "outbox_events_user_session_fkey" FOREIGN KEY ("user_id","study_session_id") REFERENCES "study"."study_sessions"("user_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" ADD CONSTRAINT "agent_runs_thread_session_pair_chk" CHECK ("agent"."agent_runs"."tutor_thread_id" IS NULL OR "agent"."agent_runs"."study_session_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "ops"."outbox_events" ADD CONSTRAINT "outbox_events_session_user_pair_chk" CHECK ("ops"."outbox_events"."study_session_id" IS NULL OR "ops"."outbox_events"."user_id" IS NOT NULL);
