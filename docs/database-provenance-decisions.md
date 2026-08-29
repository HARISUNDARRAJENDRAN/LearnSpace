# Database provenance decisions

These optional UUID references are treated as relational provenance in the frozen database foundation. They are enforced at the database boundary so an identifier cannot silently cross a user, session, thread, attempt, or retrieval run.

| Reference | Decision | Enforcement and reason |
| --- | --- | --- |
| `knowledge.artifact_details.source_agent_run_id` | ENFORCED | Composite foreign keys require the source run to have the artifact user and, when present, the artifact StudySession. |
| `study.tutor_messages.agent_run_id` | ENFORCED | A composite foreign key requires a referenced agent run to belong to the same tutor thread; that thread already carries the user and StudySession relationship. |
| `study.tutor_messages.source_message_id` | ENFORCED | A same-thread composite foreign key prevents replies or derived messages from citing another thread. |
| `practice.observer_diagnostics.model_invocation_id` | ENFORCED | A validation trigger requires the invocation's agent run to match the attempt user and StudySession. |
| `practice.hint_events.model_invocation_id` | ENFORCED | The same validation trigger protects hint-generation provenance from crossing attempt context. |
| `retrieval.citations.message_id` | ENFORCED | A validation trigger requires the tutor message thread to match the retrieval run user and StudySession. |
