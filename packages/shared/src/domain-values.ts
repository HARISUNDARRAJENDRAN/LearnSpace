export const SUBSCRIPTION_TIERS = ["free", "pro", "lifetime"] as const;
export const USER_STATUSES = ["active", "suspended", "deletion_pending", "deleted"] as const;
export const RESOURCE_TYPES = [
  "video",
  "paper",
  "pdf",
  "webpage",
  "note",
  "code",
  "diagram",
  "canvas",
  "research_result",
] as const;
export const RESOURCE_STATUSES = ["pending", "processing", "ready", "failed", "archived"] as const;
export const RESOURCE_VISIBILITIES = ["private", "unlisted", "public"] as const;
export const GOAL_STATUSES = ["active", "paused", "completed", "abandoned"] as const;
export const SESSION_MODES = ["guided_learning", "research", "practice", "review", "focus"] as const;
export const SESSION_STATUSES = ["active", "paused", "completed", "abandoned"] as const;
export const EXERCISE_KINDS = ["code", "quiz", "free_response"] as const;
export const ATTEMPT_STATUSES = ["started", "running", "submitted", "passed", "failed", "abandoned"] as const;
export const EXECUTION_STATUSES = ["queued", "running", "succeeded", "failed", "timed_out", "cancelled"] as const;
export const AGENT_RUN_STATUSES = ["planning", "executing", "synthesizing", "done", "failed", "cancelled"] as const;
export const AGENT_STEP_STATUSES = ["pending", "running", "done", "failed", "skipped", "cancelled"] as const;
export const JOB_STATUSES = ["pending", "running", "done", "failed", "dead", "cancelled"] as const;
export const OUTBOX_STATUSES = ["pending", "publishing", "published", "dead"] as const;

export const RESOURCE_ROLES = ["primary", "prerequisite", "related", "evidence", "implementation"] as const;
export const COLLECTION_KINDS = ["manual", "curated", "learning_path", "generated"] as const;
export const LIBRARY_STATUSES = ["saved", "archived", "removed"] as const;
export const GOAL_LEVELS = ["beginner", "intermediate", "advanced", "expert"] as const;
export const CHECKPOINT_KINDS = ["resume", "concept_complete", "exercise_gate", "research_thread"] as const;
export const FOCUS_MODES = ["deep_work", "pomodoro", "review", "practice"] as const;
export const PROGRESS_STATUSES = ["not_started", "active", "completed", "abandoned"] as const;
export const TUTOR_MODES = ["text", "voice", "spatial"] as const;
export const ACTOR_TYPES = ["user", "tutor", "system", "tool", "agent", "service", "runner"] as const;
export const EVENT_SOURCES = ["web", "worker", "tutor", "agent", "runner"] as const;
export const EVENT_TYPES = [
  "resource.opened",
  "resource.progressed",
  "resource.completed",
  "resource.saved",
  "resource.unsaved",
  "video.played",
  "video.paused",
  "video.seeked",
  "paper.section_opened",
  "question.asked",
  "answer.received",
  "note.created",
  "artifact.saved",
  "session.started",
  "session.paused",
  "session.completed",
  "focus.started",
  "focus.ended",
  "exercise.presented",
  "exercise.started",
  "exercise.run",
  "exercise.submitted",
  "exercise.completed",
  "hint.requested",
  "hint.presented",
  "research.started",
  "research.completed",
  "tutor.started",
  "tutor.message",
  "concept.encountered",
  "review.completed",
  "onboarding.completed",
  "discovery.dismissed",
] as const;
export const INGESTION_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export const PROCESSING_STATUSES = ["pending", "processing", "ready", "failed", "archived"] as const;
export const CHUNK_TYPES = ["transcript", "paragraph", "heading", "figure", "table", "equation", "code", "note"] as const;
export const EMBEDDING_STATUSES = ["building", "active", "retired"] as const;
export const DISTANCE_METRICS = ["cosine", "l2", "inner_product"] as const;
export const PRACTICE_VALIDATION_STATUSES = ["draft", "validated", "rejected"] as const;
export const TEST_BUNDLE_KINDS = ["sample", "hidden", "performance"] as const;
export const DIAGNOSTIC_CATEGORIES = ["syntax", "state", "boundary", "complexity", "misconception"] as const;
export const DIAGNOSTIC_SEVERITIES = ["info", "warning", "error", "critical"] as const;
export const HINT_TRIGGER_TYPES = ["explicit", "inactivity", "repeated_failure", "edge_case"] as const;
export const MASTERY_SIGNAL_TYPES = ["exposure", "recall", "correctness", "hint_dependence", "application"] as const;
export const MASTERY_STAGES = ["unseen", "seen", "understood", "practiced", "applied", "mastered"] as const;
export const ARTIFACT_TYPES = ["note", "code", "diagram", "summary", "highlight", "research_result"] as const;
export const ARTIFACT_CREATORS = ["user", "tutor", "agent", "system"] as const;
export const CONCEPT_KINDS = ["domain", "topic", "concept", "skill", "method"] as const;
export const CONCEPT_STATUSES = ["active", "retired"] as const;
export const CONCEPT_RELATION_TYPES = ["prerequisite", "part_of", "related_to", "applies_to"] as const;
export const CONCEPT_EDGE_STATUSES = ["accepted", "proposed", "retired"] as const;
export const KNOWLEDGE_EDGE_STATUSES = ["active", "retired"] as const;
export const ARTIFACT_RELATION_TYPES = ["derived_from", "summarizes", "implements", "answers"] as const;
export const ARTIFACT_CONCEPT_RELATION_TYPES = ["explains", "implements", "questions", "demonstrates"] as const;
export const RESOLUTION_STATUSES = ["unresolved", "resolved", "rejected"] as const;
export const QUESTION_STATUSES = ["open", "in_progress", "resolved", "dismissed"] as const;
export const AGENT_PURPOSES = ["session_orchestration", "retrieval", "recommendation", "practice", "research", "tutor", "memory"] as const;
export const AGENT_STEP_KINDS = ["retrieve", "tool", "reason", "synthesize", "validate"] as const;
export const INVOCATION_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export const RECOMMENDATION_SURFACES = ["discover", "home", "paper_related", "next_action"] as const;
export const RECOMMENDATION_STATUSES = ["queued", "running", "completed", "failed"] as const;
export const DISCOVERY_ACTIONS = ["open", "save", "dismiss", "start_session", "complete"] as const;
export const JOB_SOURCE_TYPES = ["job", "outbox", "consumer"] as const;
export const OUTBOX_AGGREGATE_TYPES = ["study_session", "resource", "activity_event", "exercise_attempt", "mastery", "agent_run"] as const;
export const IDEMPOTENCY_STATUSES = ["started", "completed", "failed"] as const;
export const AUDIT_ACTOR_TYPES = ["user", "service", "operator"] as const;
export const BACKFILL_STATUSES = ["pending", "running", "completed", "failed", "cancelled"] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type EventType = (typeof EVENT_TYPES)[number];
