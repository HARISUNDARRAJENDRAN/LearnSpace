ALTER TABLE "projection"."session_summary" DROP CONSTRAINT "session_summary_study_session_id_study_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "projection"."session_summary" ADD CONSTRAINT "session_summary_study_session_id_study_sessions_id_fk" FOREIGN KEY ("study_session_id") REFERENCES "study"."study_sessions"("id") ON DELETE restrict ON UPDATE no action;
