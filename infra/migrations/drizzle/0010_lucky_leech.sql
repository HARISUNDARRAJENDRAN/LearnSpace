ALTER TABLE "practice"."observer_diagnostics" DROP CONSTRAINT IF EXISTS "observer_diagnostics_execution_run_id_execution_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."observer_diagnostics" DROP CONSTRAINT IF EXISTS "observer_diagnostics_code_snapshot_id_code_snapshots_id_fk";
--> statement-breakpoint
ALTER TABLE "practice"."hint_events" DROP CONSTRAINT IF EXISTS "hint_events_diagnostic_id_observer_diagnostics_id_fk";
--> statement-breakpoint
ALTER TABLE "study"."tutor_messages" DROP CONSTRAINT IF EXISTS "tutor_messages_source_message_fkey";
--> statement-breakpoint
ALTER TABLE "study"."tutor_messages" ADD CONSTRAINT "tutor_messages_thread_id_uq" UNIQUE("thread_id","id");
--> statement-breakpoint
ALTER TABLE "practice"."execution_runs" ADD CONSTRAINT "execution_runs_attempt_id_uq" UNIQUE("attempt_id","id");
--> statement-breakpoint
ALTER TABLE "practice"."observer_diagnostics" ADD CONSTRAINT "observer_diagnostics_attempt_id_uq" UNIQUE("attempt_id","id");
--> statement-breakpoint
ALTER TABLE "agent"."agent_runs" ADD CONSTRAINT "agent_runs_thread_id_uq" UNIQUE("tutor_thread_id","id");
--> statement-breakpoint
ALTER TABLE "study"."tutor_messages" ADD CONSTRAINT "tutor_messages_source_message_fkey" FOREIGN KEY ("thread_id","source_message_id") REFERENCES "study"."tutor_messages"("thread_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "study"."tutor_messages" ADD CONSTRAINT "tutor_messages_agent_run_fkey" FOREIGN KEY ("thread_id","agent_run_id") REFERENCES "agent"."agent_runs"("tutor_thread_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "practice"."observer_diagnostics" ADD CONSTRAINT "observer_diagnostics_attempt_snapshot_fkey" FOREIGN KEY ("attempt_id","code_snapshot_id") REFERENCES "practice"."code_snapshots"("attempt_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "practice"."observer_diagnostics" ADD CONSTRAINT "observer_diagnostics_attempt_execution_fkey" FOREIGN KEY ("attempt_id","execution_run_id") REFERENCES "practice"."execution_runs"("attempt_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "practice"."exercise_bindings" ADD CONSTRAINT "exercise_bindings_session_resource_fkey" FOREIGN KEY ("study_session_id","resource_id") REFERENCES "study"."session_resources"("study_session_id","resource_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "practice"."hint_events" ADD CONSTRAINT "hint_events_attempt_diagnostic_fkey" FOREIGN KEY ("attempt_id","diagnostic_id") REFERENCES "practice"."observer_diagnostics"("attempt_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_details" ADD CONSTRAINT "artifact_details_source_agent_user_fkey" FOREIGN KEY ("user_id","source_agent_run_id") REFERENCES "agent"."agent_runs"("user_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "knowledge"."artifact_details" ADD CONSTRAINT "artifact_details_source_agent_session_fkey" FOREIGN KEY ("source_agent_run_id","study_session_id") REFERENCES "agent"."agent_runs"("id","study_session_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION study.validate_user_resource_progress_chunk()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, study, retrieval, catalog
AS $$
BEGIN
  IF NEW.last_chunk_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM retrieval.resource_chunks AS chunk
    JOIN catalog.resource_versions AS version ON version.id = chunk.resource_version_id
    WHERE chunk.id = NEW.last_chunk_id
      AND version.resource_id = NEW.resource_id
  ) THEN
    RAISE EXCEPTION 'progress chunk does not belong to progress resource' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION study.validate_user_resource_progress_chunk() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION study.validate_user_resource_progress_chunk() TO learnspace_app, learnspace_worker, learnspace_migrator;
--> statement-breakpoint
DROP TRIGGER IF EXISTS user_resource_progress_chunk_resource_trg ON study.user_resource_progress;
--> statement-breakpoint
CREATE TRIGGER user_resource_progress_chunk_resource_trg
BEFORE INSERT OR UPDATE OF resource_id, last_chunk_id ON study.user_resource_progress
FOR EACH ROW EXECUTE FUNCTION study.validate_user_resource_progress_chunk();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION practice.validate_model_invocation_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, practice, agent
AS $$
BEGIN
  IF NEW.model_invocation_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM practice.exercise_attempts AS attempt
    JOIN agent.model_invocations AS invocation ON invocation.id = NEW.model_invocation_id
    JOIN agent.agent_runs AS run ON run.id = invocation.agent_run_id
    WHERE attempt.id = NEW.attempt_id
      AND run.user_id = attempt.user_id
      AND run.study_session_id IS NOT DISTINCT FROM attempt.study_session_id
  ) THEN
    RAISE EXCEPTION 'model invocation is not compatible with exercise attempt' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION practice.validate_model_invocation_attempt() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION practice.validate_model_invocation_attempt() TO learnspace_app, learnspace_worker, learnspace_migrator;
--> statement-breakpoint
DROP TRIGGER IF EXISTS observer_diagnostics_model_invocation_trg ON practice.observer_diagnostics;
--> statement-breakpoint
CREATE TRIGGER observer_diagnostics_model_invocation_trg
BEFORE INSERT OR UPDATE OF attempt_id, model_invocation_id ON practice.observer_diagnostics
FOR EACH ROW EXECUTE FUNCTION practice.validate_model_invocation_attempt();
--> statement-breakpoint
DROP TRIGGER IF EXISTS hint_events_model_invocation_trg ON practice.hint_events;
--> statement-breakpoint
CREATE TRIGGER hint_events_model_invocation_trg
BEFORE INSERT OR UPDATE OF attempt_id, model_invocation_id ON practice.hint_events
FOR EACH ROW EXECUTE FUNCTION practice.validate_model_invocation_attempt();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION retrieval.validate_citation_message_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, retrieval, study
AS $$
BEGIN
  IF NEW.message_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM retrieval.retrieval_runs AS retrieval_run
    JOIN study.tutor_messages AS message ON message.id = NEW.message_id
    JOIN study.tutor_threads AS thread ON thread.id = message.thread_id
    WHERE retrieval_run.id = NEW.retrieval_run_id
      AND thread.user_id = retrieval_run.user_id
      AND thread.study_session_id IS NOT DISTINCT FROM retrieval_run.study_session_id
  ) THEN
    RAISE EXCEPTION 'citation message is not compatible with retrieval run' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION retrieval.validate_citation_message_context() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION retrieval.validate_citation_message_context() TO learnspace_app, learnspace_ai, learnspace_worker, learnspace_migrator;
--> statement-breakpoint
DROP TRIGGER IF EXISTS citations_message_context_trg ON retrieval.citations;
--> statement-breakpoint
CREATE TRIGGER citations_message_context_trg
BEFORE INSERT OR UPDATE OF retrieval_run_id, message_id ON retrieval.citations
FOR EACH ROW EXECUTE FUNCTION retrieval.validate_citation_message_context();
--> statement-breakpoint
DROP POLICY IF EXISTS exercise_bindings_owner_insert_policy ON practice.exercise_bindings;
--> statement-breakpoint
CREATE POLICY exercise_bindings_owner_insert_policy ON practice.exercise_bindings
  FOR INSERT TO learnspace_app
  WITH CHECK (
    study_session_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM study.study_sessions AS session
      WHERE session.id = study_session_id
        AND session.user_id::text = current_setting('app.user_id', true)
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS exercise_bindings_owner_update_policy ON practice.exercise_bindings;
--> statement-breakpoint
CREATE POLICY exercise_bindings_owner_update_policy ON practice.exercise_bindings
  FOR UPDATE TO learnspace_app
  USING (
    study_session_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM study.study_sessions AS session
      WHERE session.id = study_session_id
        AND session.user_id::text = current_setting('app.user_id', true)
    )
  )
  WITH CHECK (
    study_session_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM study.study_sessions AS session
      WHERE session.id = study_session_id
        AND session.user_id::text = current_setting('app.user_id', true)
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS exercise_bindings_owner_delete_policy ON practice.exercise_bindings;
--> statement-breakpoint
CREATE POLICY exercise_bindings_owner_delete_policy ON practice.exercise_bindings
  FOR DELETE TO learnspace_app
  USING (
    study_session_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM study.study_sessions AS session
      WHERE session.id = study_session_id
        AND session.user_id::text = current_setting('app.user_id', true)
    )
  );
--> statement-breakpoint
DROP POLICY IF EXISTS agent_artifacts_owner_policy ON agent.agent_artifacts;
--> statement-breakpoint
DROP POLICY IF EXISTS agent_artifacts_owner_insert_policy ON agent.agent_artifacts;
--> statement-breakpoint
DROP POLICY IF EXISTS agent_artifacts_owner_update_policy ON agent.agent_artifacts;
--> statement-breakpoint
CREATE POLICY agent_artifacts_owner_select_policy ON agent.agent_artifacts
  FOR SELECT TO learnspace_ai
  USING (
    EXISTS (
      SELECT 1
      FROM agent.agent_runs AS run
      JOIN catalog.resources AS resource ON resource.id = agent_artifacts.resource_id
      WHERE run.id = agent_artifacts.agent_run_id
        AND run.user_id::text = current_setting('app.user_id', true)
        AND (
          resource.owner_user_id::text = current_setting('app.user_id', true)
          OR resource.visibility IN ('public', 'unlisted')
        )
    )
  );
--> statement-breakpoint
CREATE POLICY agent_artifacts_owner_insert_policy ON agent.agent_artifacts
  FOR INSERT TO learnspace_ai
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM agent.agent_runs AS run
      JOIN catalog.resources AS resource ON resource.id = agent_artifacts.resource_id
      WHERE run.id = agent_artifacts.agent_run_id
        AND run.user_id::text = current_setting('app.user_id', true)
        AND (
          resource.owner_user_id::text = current_setting('app.user_id', true)
          OR resource.visibility IN ('public', 'unlisted')
        )
    )
  );
--> statement-breakpoint
CREATE POLICY agent_artifacts_owner_update_policy ON agent.agent_artifacts
  FOR UPDATE TO learnspace_ai
  USING (
    EXISTS (
      SELECT 1
      FROM agent.agent_runs AS run
      JOIN catalog.resources AS resource ON resource.id = agent_artifacts.resource_id
      WHERE run.id = agent_artifacts.agent_run_id
        AND run.user_id::text = current_setting('app.user_id', true)
        AND (
          resource.owner_user_id::text = current_setting('app.user_id', true)
          OR resource.visibility IN ('public', 'unlisted')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM agent.agent_runs AS run
      JOIN catalog.resources AS resource ON resource.id = agent_artifacts.resource_id
      WHERE run.id = agent_artifacts.agent_run_id
        AND run.user_id::text = current_setting('app.user_id', true)
        AND (
          resource.owner_user_id::text = current_setting('app.user_id', true)
          OR resource.visibility IN ('public', 'unlisted')
        )
    )
  );
--> statement-breakpoint
CREATE POLICY agent_artifacts_owner_delete_policy ON agent.agent_artifacts
  FOR DELETE TO learnspace_ai
  USING (
    EXISTS (
      SELECT 1
      FROM agent.agent_runs AS run
      JOIN catalog.resources AS resource ON resource.id = agent_artifacts.resource_id
      WHERE run.id = agent_artifacts.agent_run_id
        AND run.user_id::text = current_setting('app.user_id', true)
        AND (
          resource.owner_user_id::text = current_setting('app.user_id', true)
          OR resource.visibility IN ('public', 'unlisted')
        )
    )
  );
