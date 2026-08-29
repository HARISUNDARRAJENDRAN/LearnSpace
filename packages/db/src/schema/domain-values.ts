import {
  AGENT_RUN_STATUSES,
  AGENT_STEP_STATUSES,
  ATTEMPT_STATUSES,
  EXECUTION_STATUSES,
  EXERCISE_KINDS,
  GOAL_STATUSES,
  JOB_STATUSES,
  OUTBOX_STATUSES,
  RESOURCE_STATUSES,
  RESOURCE_TYPES,
  RESOURCE_VISIBILITIES,
  SESSION_MODES,
  SESSION_STATUSES,
  SUBSCRIPTION_TIERS,
  USER_STATUSES,
} from "@learnspace/shared/domain-values";
import { agentSchema, catalogSchema, identitySchema, opsSchema, practiceSchema, studySchema } from "./namespaces.js";

export const subscriptionTier = identitySchema.enum("subscription_tier", SUBSCRIPTION_TIERS);
export const userStatus = identitySchema.enum("user_status", USER_STATUSES);
export const resourceType = catalogSchema.enum("resource_type", RESOURCE_TYPES);
export const resourceStatus = catalogSchema.enum("resource_status", RESOURCE_STATUSES);
export const resourceVisibility = catalogSchema.enum("resource_visibility", RESOURCE_VISIBILITIES);
export const goalStatus = studySchema.enum("goal_status", GOAL_STATUSES);
export const sessionMode = studySchema.enum("session_mode", SESSION_MODES);
export const sessionStatus = studySchema.enum("session_status", SESSION_STATUSES);
export const exerciseKind = practiceSchema.enum("exercise_kind", EXERCISE_KINDS);
export const attemptStatus = practiceSchema.enum("attempt_status", ATTEMPT_STATUSES);
export const executionStatus = practiceSchema.enum("execution_status", EXECUTION_STATUSES);
export const agentRunStatus = agentSchema.enum("run_status", AGENT_RUN_STATUSES);
export const agentStepStatus = agentSchema.enum("step_status", AGENT_STEP_STATUSES);
export const jobStatus = opsSchema.enum("job_status", JOB_STATUSES);
export const outboxStatus = opsSchema.enum("outbox_status", OUTBOX_STATUSES);
