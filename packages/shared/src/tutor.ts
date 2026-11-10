import { z } from "zod";

/** Bumped whenever the prompt, output schema or grounding rules change; cached answers from another contract are never reused. */
export const TUTOR_CONTRACT_VERSION = "tutor-v9";
/** Transcript chunk embeddings share the discovery embedding model but live in their own retrieval profile. */
export const TRANSCRIPT_EMBEDDING_PROFILE = "openai-text-embedding-3-small-1536";
export const MAX_EVIDENCE = 24;

// What the model may write. Evidence is cited by its number in the prompt (1-based); the server maps it to real chunks.
const cite = z.array(z.number().int().min(1).max(MAX_EVIDENCE)).max(4);
const oneCite = z.number().int().min(1).max(MAX_EVIDENCE);
// Every citation comes before the words it supports, so an answer streams with its grounding already decided.
const citedLine = z.object({ cite, text: z.string() }).strict();

const modelBlockSchema = z.union([
  z.object({ type: z.literal("text"), cite, text: z.string() }).strict(),
  z.object({ type: z.literal("concept"), cite, term: z.string(), definition: z.string() }).strict(),
  z.object({ type: z.literal("steps"), title: z.string(), items: z.array(citedLine).max(8) }).strict(),
  z.object({ type: z.literal("compare"), cite, title: z.string(), columns: z.array(z.object({ label: z.string(), points: z.array(z.string()).max(6) }).strict()).min(2).max(3) }).strict(),
  z.object({ type: z.literal("outline"), title: z.string(), items: z.array(citedLine).max(10) }).strict(),
  z.object({ type: z.literal("timeline"), title: z.string(), items: z.array(z.object({ cite: oneCite, label: z.string() }).strict()).max(10) }).strict(),
  // Diagrams: a chain of stages joined by labelled arrows (closing back on itself when `loop`), or one idea split into its parts.
  z.object({ type: z.literal("flow"), title: z.string(), loop: z.boolean(), nodes: z.array(z.object({ cite, label: z.string(), detail: z.string(), arrow: z.string() }).strict()).min(2).max(6) }).strict(),
  z.object({ type: z.literal("tree"), cite, title: z.string(), root: z.string(), branches: z.array(z.object({ cite, label: z.string(), detail: z.string(), leaves: z.array(z.string()).max(4) }).strict()).min(2).max(5) }).strict(),
  z.object({ type: z.literal("evidence"), cite: oneCite, note: z.string() }).strict(),
  z.object({ type: z.literal("question"), cite, prompt: z.string(), hint: z.string(), concept: z.string() }).strict(),
  z.object({ type: z.literal("check"), cite, question: z.string(), options: z.array(z.string()).min(2).max(5), answer: z.number().int().min(0).max(4), explanation: z.string(), hint: z.string(), concept: z.string() }).strict(),
]);

export const tutorModelOutputSchema = z.object({
  // Written first, so the server knows within a few tokens whether to ask again with reasoning.
  needsReasoning: z.boolean(),
  outcome: z.enum(["answer", "general", "clarify", "not_covered", "off_topic"]),
  blocks: z.array(modelBlockSchema).max(8),
  followUps: z.array(z.string()).max(3),
  learner: z.object({
    goal: z.string().nullable(),
    concepts: z.array(z.object({ name: z.string(), status: z.enum(["introduced", "struggling"]) }).strict()).max(6),
    openQuestions: z.array(z.string()).max(3),
    nextStep: z.string(),
  }).strict(),
}).strict();
export type TutorModelOutput = z.infer<typeof tutorModelOutputSchema>;
export type TutorModelBlock = z.infer<typeof modelBlockSchema>;

/** A schema as OpenAI strict structured-output JSON Schema (no `$schema`, `const` spelled as `enum`). */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
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
  return strip(z.toJSONSchema(schema, { target: "draft-7" })) as Record<string, unknown>;
}

/** The tutor's output schema. `reasoning` is the second, reasoning call for a turn: it can only answer, never ask to reason again. */
export function tutorOutputJsonSchema(reasoning = false): Record<string, unknown> {
  return strictJsonSchema(reasoning ? tutorModelOutputSchema.extend({ needsReasoning: z.literal(false) }) : tutorModelOutputSchema);
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
  z.object({ type: z.literal("flow"), id: z.string(), title: z.string(), loop: z.boolean(), nodes: z.array(z.object({ label: z.string(), detail: z.string(), arrow: z.string(), src }).strict()) }).strict(),
  z.object({ type: z.literal("tree"), id: z.string(), title: z.string(), root: z.string(), src, branches: z.array(z.object({ label: z.string(), detail: z.string(), leaves: z.array(z.string()), src }).strict()) }).strict(),
  z.object({ type: z.literal("evidence"), id: z.string(), note: z.string(), src: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal("question"), prompt: z.string(), ...interactive }).strict(),
  z.object({
    type: z.literal("check"), question: z.string(), options: z.array(z.string()).min(2).max(5), ...interactive,
    result: z.object({ choice: z.number().int(), correct: z.boolean(), answer: z.number().int(), explanation: z.string() }).strict().nullable(),
  }).strict(),
]);
export type TutorBlockView = z.infer<typeof tutorBlockViewSchema>;
export type TutorSource = z.infer<typeof tutorSourceSchema>;

/** "general" answers a learning question the video doesn't cover from established knowledge, with no transcript citations. */
export const tutorOutcomeSchema = z.enum(["answer", "general", "clarify", "not_covered", "off_topic"]);
export type TutorOutcome = z.infer<typeof tutorOutcomeSchema>;

const blockId = z.string().regex(/^b\d{1,2}$/);

/** A doubt: words the learner highlighted in an answer, and the side thread of questions about them. */
export const tutorDoubtSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
  blockId,
  quote: z.string().trim().min(1).max(600),
  /** Which match of the quote in the block's text, counting from 0, so a repeated phrase marks the right one. */
  occurrence: z.number().int().min(0).max(100),
}).strict();
export type TutorDoubt = z.infer<typeof tutorDoubtSchema>;

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
  /** Questions the learner might ask next, offered as one-tap prompts under the latest answer. */
  followUps: z.array(z.string()),
  /** The answer cites an older transcript version than the video now has. */
  stale: z.boolean(),
  /** Set on the questions and answers of a doubt thread, which stay out of the main conversation. */
  doubt: tutorDoubtSchema.nullable(),
}).strict();
export type TutorMessageView = z.infer<typeof tutorMessageViewSchema>;

export type TutorTranscriptStatus = "ready" | "preparing" | "unavailable" | "failed";
export type TutorConceptStatus = "introduced" | "struggling" | "demonstrated";
export type TutorThreadView = {
  resourceId: string;
  transcript: { status: TutorTranscriptStatus; source: string | null };
  messages: TutorMessageView[];
  learner: { goal: string | null; concepts: Array<{ name: string; status: TutorConceptStatus }>; nextStep: string | null };
  /** Earlier conversations about this video, newest first; any of them can be restored. */
  history: Array<{ id: string; title: string; preview: string | null; updatedAt: string }>;
  /** Doubts the learner marked "Got it". */
  resolvedDoubts: string[];
};

/** Streamed to the browser as one JSON object per line. */
export type TutorStreamEvent =
  | { type: "accepted"; user: TutorMessageView; assistantId: string }
  | { type: "phase"; phase: "retrieving" | "thinking" | "reasoning" | "writing" }
  /** The answer so far, grounded like the final one; each draft replaces the last until `done`. */
  | { type: "draft"; message: TutorMessageView }
  | { type: "done"; message: TutorMessageView }
  | { type: "error"; code: string; message: string };

const idempotencyKey = z.string().trim().min(8).max(128);

export const tutorTurnRequestSchema = z.object({
  question: z.string().trim().min(1).max(1_000),
  positionMs: z.number().int().min(0).max(86_400_000),
  replyTo: z.object({ messageId: z.string().uuid(), blockId }).strict().optional(),
  doubt: tutorDoubtSchema.optional(),
  idempotencyKey,
}).strict().refine((input) => !(input.replyTo && input.doubt), "A turn answers a check or asks about a doubt, not both.");
export type TutorTurnRequest = z.infer<typeof tutorTurnRequestSchema>;

/** Restores an earlier conversation, or marks a doubt resolved ("Got it") or open again. */
export const tutorThreadActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("restore"), threadId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("resolve"), doubtId: z.string().uuid(), resolved: z.boolean() }).strict(),
]);

export const tutorInteractionRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answer"), messageId: z.string().uuid(), blockId, choice: z.number().int().min(0).max(4) }).strict(),
  z.object({ action: z.literal("hint"), messageId: z.string().uuid(), blockId }).strict(),
]);
export type TutorInteractionRequest = z.infer<typeof tutorInteractionRequestSchema>;
