import { z } from "zod";

/** Bumped whenever the prompt, output schema or grounding rules change; cached answers from another contract are never reused. */
export const TUTOR_CONTRACT_VERSION = "tutor-v2";
/** Transcript chunk embeddings share the discovery embedding model but live in their own retrieval profile. */
export const TRANSCRIPT_EMBEDDING_PROFILE = "openai-text-embedding-3-small-1536";
export const MAX_EVIDENCE = 24;

// What the model may write. Evidence is cited by its number in the prompt (1-based); the server maps it to real chunks.
const cite = z.array(z.number().int().min(1).max(MAX_EVIDENCE)).max(4);
const oneCite = z.number().int().min(1).max(MAX_EVIDENCE);
const citedLine = z.object({ text: z.string(), cite }).strict();

const modelBlockSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string(), cite }).strict(),
  z.object({ type: z.literal("concept"), term: z.string(), definition: z.string(), cite }).strict(),
  z.object({ type: z.literal("steps"), title: z.string(), items: z.array(citedLine).max(8) }).strict(),
  z.object({ type: z.literal("compare"), title: z.string(), columns: z.array(z.object({ label: z.string(), points: z.array(z.string()).max(6) }).strict()).min(2).max(3), cite }).strict(),
  z.object({ type: z.literal("outline"), title: z.string(), items: z.array(citedLine).max(10) }).strict(),
  z.object({ type: z.literal("timeline"), title: z.string(), items: z.array(z.object({ label: z.string(), cite: oneCite }).strict()).max(10) }).strict(),
  z.object({ type: z.literal("evidence"), note: z.string(), cite: oneCite }).strict(),
  z.object({ type: z.literal("question"), prompt: z.string(), hint: z.string(), concept: z.string(), cite }).strict(),
  z.object({ type: z.literal("check"), question: z.string(), options: z.array(z.string()).min(2).max(5), answer: z.number().int().min(0).max(4), explanation: z.string(), hint: z.string(), concept: z.string(), cite }).strict(),
]);

export const tutorModelOutputSchema = z.object({
  outcome: z.enum(["answer", "clarify", "not_covered", "off_topic"]),
  blocks: z.array(modelBlockSchema).max(8),
  learner: z.object({
    goal: z.string().nullable(),
    concepts: z.array(z.object({ name: z.string(), status: z.enum(["introduced", "struggling"]) }).strict()).max(6),
    openQuestions: z.array(z.string()).max(3),
    nextStep: z.string(),
  }).strict(),
}).strict();
export type TutorModelOutput = z.infer<typeof tutorModelOutputSchema>;
export type TutorModelBlock = z.infer<typeof modelBlockSchema>;

/** The same schema as OpenAI strict structured-output JSON Schema (no `$schema`, `const` spelled as `enum`). */
export function tutorOutputJsonSchema(): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "$schema") continue;
      if (key === "const") out.enum = [value];
      else out[key] = strip(value);
    }
    return out;
  };
  return strip(z.toJSONSchema(tutorModelOutputSchema, { target: "draft-7" })) as Record<string, unknown>;
}

// What the browser receives. Sources are server-resolved chunks; blocks point at them by index.
const src = z.array(z.number().int().min(0)).max(4);
export const tutorSourceSchema = z.object({ chunkId: z.string().uuid(), startMs: z.number().int().min(0).nullable(), endMs: z.number().int().min(0).nullable(), excerpt: z.string() }).strict();
const viewLine = z.object({ text: z.string(), src }).strict();
const interactive = { id: z.string(), concept: z.string(), src, hintAvailable: z.boolean(), hint: z.string().nullable() };

export const tutorBlockViewSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), id: z.string(), text: z.string(), src }).strict(),
  z.object({ type: z.literal("concept"), id: z.string(), term: z.string(), definition: z.string(), src }).strict(),
  z.object({ type: z.literal("steps"), id: z.string(), title: z.string(), items: z.array(viewLine) }).strict(),
  z.object({ type: z.literal("compare"), id: z.string(), title: z.string(), columns: z.array(z.object({ label: z.string(), points: z.array(z.string()) }).strict()), src }).strict(),
  z.object({ type: z.literal("outline"), id: z.string(), title: z.string(), items: z.array(viewLine) }).strict(),
  z.object({ type: z.literal("timeline"), id: z.string(), title: z.string(), items: z.array(z.object({ label: z.string(), src: z.number().int().min(0) }).strict()) }).strict(),
  z.object({ type: z.literal("evidence"), id: z.string(), note: z.string(), src: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal("question"), prompt: z.string(), ...interactive }).strict(),
  z.object({
    type: z.literal("check"), question: z.string(), options: z.array(z.string()).min(2).max(5), ...interactive,
    result: z.object({ choice: z.number().int(), correct: z.boolean(), answer: z.number().int(), explanation: z.string() }).strict().nullable(),
  }).strict(),
]);
export type TutorBlockView = z.infer<typeof tutorBlockViewSchema>;
export type TutorSource = z.infer<typeof tutorSourceSchema>;

export const tutorOutcomeSchema = z.enum(["answer", "clarify", "not_covered", "off_topic"]);
export type TutorOutcome = z.infer<typeof tutorOutcomeSchema>;

export const tutorMessageViewSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  status: z.enum(["pending", "completed", "failed", "cancelled"]),
  createdAt: z.string(),
  text: z.string(),
  positionMs: z.number().int().nullable(),
  outcome: tutorOutcomeSchema.nullable(),
  blocks: z.array(tutorBlockViewSchema),
  sources: z.array(tutorSourceSchema),
  /** The answer cites an older transcript version than the video now has. */
  stale: z.boolean(),
}).strict();
export type TutorMessageView = z.infer<typeof tutorMessageViewSchema>;

export type TutorTranscriptStatus = "ready" | "preparing" | "unavailable" | "failed";
export type TutorConceptStatus = "introduced" | "struggling" | "demonstrated";
export type TutorThreadView = {
  resourceId: string;
  transcript: { status: TutorTranscriptStatus; source: string | null };
  messages: TutorMessageView[];
  learner: { goal: string | null; concepts: Array<{ name: string; status: TutorConceptStatus }>; nextStep: string | null };
};

/** Streamed to the browser as one JSON object per line. */
export type TutorStreamEvent =
  | { type: "accepted"; user: TutorMessageView; assistantId: string }
  | { type: "phase"; phase: "retrieving" | "thinking" | "writing" }
  | { type: "done"; message: TutorMessageView }
  | { type: "error"; code: string; message: string };

const idempotencyKey = z.string().trim().min(8).max(128);

export const tutorTurnRequestSchema = z.object({
  question: z.string().trim().min(1).max(1_000),
  positionMs: z.number().int().min(0).max(86_400_000),
  replyTo: z.object({ messageId: z.string().uuid(), blockId: z.string().regex(/^b\d{1,2}$/) }).strict().optional(),
  idempotencyKey,
}).strict();
export type TutorTurnRequest = z.infer<typeof tutorTurnRequestSchema>;

export const tutorInteractionRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answer"), messageId: z.string().uuid(), blockId: z.string().regex(/^b\d{1,2}$/), choice: z.number().int().min(0).max(4) }).strict(),
  z.object({ action: z.literal("hint"), messageId: z.string().uuid(), blockId: z.string().regex(/^b\d{1,2}$/) }).strict(),
]);
export type TutorInteractionRequest = z.infer<typeof tutorInteractionRequestSchema>;
