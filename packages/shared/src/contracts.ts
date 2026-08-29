import { z } from "zod";
import {
  ACTOR_TYPES,
  EVENT_SOURCES,
  EVENT_TYPES,
  RESOURCE_TYPES,
  SESSION_MODES,
  SUBSCRIPTION_TIERS,
} from "./domain-values.js";

export const subscriptionTierSchema = z.enum(SUBSCRIPTION_TIERS);
export const resourceTypeSchema = z.enum(RESOURCE_TYPES);
export const sessionModeSchema = z.enum(SESSION_MODES);
export const activityEventTypeSchema = z.enum(EVENT_TYPES);
export const activityActorTypeSchema = z.enum(ACTOR_TYPES);
export const activitySourceSchema = z.enum(EVENT_SOURCES);

export const activityEventContract = z.object({
  schemaVersion: z.number().int().positive(),
  userId: z.string().uuid(),
  studySessionId: z.string().uuid().nullable().optional(),
  resourceId: z.string().uuid().nullable().optional(),
  resourceVersionId: z.string().uuid().nullable().optional(),
  conceptId: z.string().uuid().nullable().optional(),
  eventType: activityEventTypeSchema,
  actorType: activityActorTypeSchema,
  source: activitySourceSchema,
  occurredAt: z.coerce.date(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const idempotencyRequestContract = z.object({
  scope: z.string().min(1),
  idempotencyKey: z.string().min(1),
  requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export type ActivityEventContract = z.infer<typeof activityEventContract>;
export type IdempotencyRequestContract = z.infer<typeof idempotencyRequestContract>;
