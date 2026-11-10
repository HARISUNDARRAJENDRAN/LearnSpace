import type { TutorBlockView, TutorConceptStatus, TutorModelBlock, TutorModelOutput, TutorOutcome, TutorSource } from "@learnspace/shared/tutor";

/** A retrieved transcript chunk the model was shown, numbered from 1 in the prompt. */
export type Evidence = { chunkId: string; ordinal: number; startMs: number | null; endMs: number | null; content: string };

// Answers to checks and hints stay on the server until the learner earns them.
type Hidden = { answer?: number; explanation?: string; hint?: string };
export type StoredBlock = (Exclude<TutorBlockView, { type: "question" | "check" }> | Omit<Extract<TutorBlockView, { type: "question" }>, "hintAvailable" | "hint"> | Omit<Extract<TutorBlockView, { type: "check" }>, "hintAvailable" | "hint" | "result">) & Hidden;
export type Interaction = { choice?: number; correct?: boolean; hint?: boolean };
export type GroundedAnswer = { outcome: TutorOutcome; blocks: StoredBlock[]; sources: TutorSource[] };

export const OUTCOME_NOTICE: Record<Exclude<TutorOutcome, "answer" | "clarify">, string> = {
  not_covered: "This isn't covered in the transcript of this video. Ask about something the instructor discusses, or jump to the part you mean and ask again.",
  off_topic: "I can only help with what this video teaches. Ask me about something from the lesson.",
};

// Evidence numbers the model repeats in prose ("…count 8. [2][3]"); the app shows citations from the cite fields.
// shortcut: also drops a standalone literal like "x = [1]" in quoted code, upgrade to cite-aware parsing if lessons quote such code.
const CITE_MARKERS = /[ \t]*(?<![\w\])])(?:\[\d{1,2}(?:\s*[,–-]\s*\d{1,2})*\])+(?=[\s.,;:!?)]|$)/g;
const clean = (value: string, max: number) => value.replace(CITE_MARKERS, "").replace(/(?!\n)\p{Cc}/gu, " ").replace(/[ \t]+/g, " ").trim().slice(0, max);
const nonEmpty = (value: string) => value.length > 0;

/** A short passage of the chunk around the first question term it contains, for the citation preview. */
export function excerptOf(content: string, terms: string[] = []): string {
  const lower = content.toLowerCase();
  const hit = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - 100);
  const slice = content.slice(start, start + 280).trim();
  return `${start > 0 ? "…" : ""}${slice}${start + 280 < content.length ? "…" : ""}`;
}

/**
 * Turns the model's output into what is stored and shown: citations must name evidence the model was given,
 * blocks without valid citations are removed, and an answer left with nothing grounded becomes "not covered".
 */
export function groundOutput(output: TutorModelOutput, evidence: Evidence[], terms: string[] = []): GroundedAnswer {
  if (output.outcome === "not_covered" || output.outcome === "off_topic") return { outcome: output.outcome, blocks: [], sources: [] };
  if (output.outcome === "clarify") {
    const ask = output.blocks.find((block): block is Extract<TutorModelBlock, { type: "text" }> => block.type === "text");
    const text = ask ? clean(ask.text, 400) : "";
    return text ? { outcome: "clarify", blocks: [{ type: "text", id: "b0", text, src: [] }], sources: [] } : { outcome: "not_covered", blocks: [], sources: [] };
  }
  const sources: TutorSource[] = [];
  const sourceIndex = new Map<number, number>();
  const map = (cite: number): number | null => {
    const item = evidence[cite - 1];
    if (!item) return null;
    let index = sourceIndex.get(cite);
    if (index === undefined) {
      index = sources.length;
      sourceIndex.set(cite, index);
      sources.push({ chunkId: item.chunkId, startMs: item.startMs, endMs: item.endMs, excerpt: excerptOf(item.content, terms) });
    }
    return index;
  };
  const mapAll = (cites: number[]) => [...new Set(cites.flatMap((cite) => map(cite) ?? []))];
  const blocks: StoredBlock[] = [];
  for (const block of output.blocks) {
    const id = `b${blocks.length}`;
    const grounded = groundBlock(block, id, mapAll, map);
    if (grounded) blocks.push(grounded);
  }
  if (blocks.length === 0) return { outcome: "not_covered", blocks: [], sources: [] };
  // Sources only some removed block used are dropped from the answer too.
  const used = new Set(blocks.flatMap(blockSources));
  const keep = sources.flatMap((source, index) => used.has(index) ? [index] : []);
  const renumber = new Map(keep.map((old, index) => [old, index]));
  return { outcome: "answer", blocks: blocks.map((block) => renumberBlock(block, (index) => renumber.get(index)!)), sources: keep.map((index) => sources[index]!) };
}

function groundBlock(block: TutorModelBlock, id: string, mapAll: (cites: number[]) => number[], map: (cite: number) => number | null): StoredBlock | null {
  switch (block.type) {
    case "text": {
      const src = mapAll(block.cite);
      const text = clean(block.text.replace(/\n{3,}/g, "\n\n"), 1_500);
      return src.length && text ? { type: "text", id, text, src } : null;
    }
    case "concept": {
      const src = mapAll(block.cite);
      const term = clean(block.term, 80);
      const definition = clean(block.definition, 600);
      return src.length && term && definition ? { type: "concept", id, term, definition, src } : null;
    }
    case "steps":
    case "outline": {
      const items = block.items.flatMap((item) => {
        const src = mapAll(item.cite);
        const text = clean(item.text, 400);
        return src.length && text ? [{ text, src }] : [];
      });
      return items.length ? { type: block.type, id, title: clean(block.title, 120), items } : null;
    }
    case "compare": {
      const src = mapAll(block.cite);
      const columns = block.columns.map((column) => ({ label: clean(column.label, 60), points: column.points.map((point) => clean(point, 240)).filter(nonEmpty) })).filter((column) => column.label && column.points.length);
      return src.length && columns.length >= 2 ? { type: "compare", id, title: clean(block.title, 120), columns, src } : null;
    }
    case "timeline": {
      const items = block.items.flatMap((item) => {
        const src = map(item.cite);
        const label = clean(item.label, 160);
        return src !== null && label ? [{ label, src }] : [];
      });
      return items.length ? { type: "timeline", id, title: clean(block.title, 120), items } : null;
    }
    case "evidence": {
      const src = map(block.cite);
      return src === null ? null : { type: "evidence", id, note: clean(block.note, 240), src };
    }
    case "question": {
      const src = mapAll(block.cite);
      const prompt = clean(block.prompt, 400);
      return src.length && prompt ? { type: "question", id, prompt, concept: clean(block.concept, 60), src, hint: clean(block.hint, 300) } : null;
    }
    case "check": {
      const src = mapAll(block.cite);
      const options = block.options.map((option) => clean(option, 200));
      const distinct = new Set(options.map((option) => option.toLowerCase())).size === options.length;
      const question = clean(block.question, 400);
      if (!src.length || !question || !distinct || options.some((option) => !option) || block.answer >= options.length) return null;
      return { type: "check", id, question, options, concept: clean(block.concept, 60), src, answer: block.answer, explanation: clean(block.explanation, 600), hint: clean(block.hint, 300) };
    }
  }
}

function blockSources(block: StoredBlock): number[] {
  if (block.type === "steps" || block.type === "outline") return block.items.flatMap((item) => item.src);
  if (block.type === "timeline") return block.items.map((item) => item.src);
  if (block.type === "evidence") return [block.src];
  return block.src;
}

function renumberBlock(block: StoredBlock, to: (index: number) => number): StoredBlock {
  if (block.type === "steps" || block.type === "outline") return { ...block, items: block.items.map((item) => ({ ...item, src: item.src.map(to) })) };
  if (block.type === "timeline") return { ...block, items: block.items.map((item) => ({ ...item, src: to(item.src) })) };
  if (block.type === "evidence") return { ...block, src: to(block.src) };
  return { ...block, src: block.src.map(to) } as StoredBlock;
}

/** What the browser may see: a check's answer and explanation only once it is answered, a hint only once asked for. */
export function blockView(block: StoredBlock, interaction: Interaction | undefined): TutorBlockView {
  if (block.type === "question") {
    const { hint, answer: _answer, explanation: _explanation, ...rest } = block;
    return { ...rest, hintAvailable: Boolean(hint), hint: interaction?.hint ? hint ?? null : null };
  }
  if (block.type === "check") {
    const { hint, answer, explanation, ...rest } = block;
    const answered = interaction?.choice !== undefined;
    return {
      ...rest,
      hintAvailable: Boolean(hint),
      hint: interaction?.hint || answered ? hint ?? null : null,
      result: answered ? { choice: interaction.choice!, correct: Boolean(interaction.correct), answer: answer ?? 0, explanation: explanation ?? "" } : null,
    };
  }
  const { answer: _answer, explanation: _explanation, hint: _hint, ...rest } = block;
  return rest as TutorBlockView;
}

/** Plain text of an answer, for copying and for the conversation history the next turn sees. */
export function answerText(blocks: StoredBlock[], interactions: Record<string, Interaction> = {}): string {
  return blocks.map((block) => {
    switch (block.type) {
      case "text": return block.text;
      case "concept": return `${block.term}: ${block.definition}`;
      case "steps": case "outline": return [block.title, ...block.items.map((item, index) => `${index + 1}. ${item.text}`)].filter(Boolean).join("\n");
      case "compare": return [block.title, ...block.columns.map((column) => `${column.label}: ${column.points.join("; ")}`)].filter(Boolean).join("\n");
      case "timeline": return [block.title, ...block.items.map((item) => `- ${item.label}`)].filter(Boolean).join("\n");
      case "evidence": return block.note;
      case "question": return `Question for the learner: ${block.prompt}`;
      case "check": {
        const done = interactions[block.id];
        const outcome = done?.choice === undefined ? "not answered yet" : `learner chose "${block.options[done.choice]}" (${done.correct ? "correct" : "incorrect"})`;
        return `Check (${block.concept}): ${block.question} Options: ${block.options.map((option, index) => `${index + 1}) ${option}`).join(" ")} — ${outcome}`;
      }
      default: return "";
    }
  }).join("\n\n");
}

// The learner record is small and typed. Understanding is only ever marked from a graded check, never by the model.
export type LearnerState = {
  goal: string | null;
  concepts: Array<{ name: string; status: TutorConceptStatus; evidence: string[] }>;
  openQuestions: string[];
  nextStep: string | null;
  hintsGiven: number;
  checks: { correct: number; wrong: number };
  lastCheck: { concept: string; correct: boolean } | null;
  turnsSinceCheck: number;
};

export function emptyLearner(): LearnerState {
  return { goal: null, concepts: [], openQuestions: [], nextStep: null, hintsGiven: 0, checks: { correct: 0, wrong: 0 }, lastCheck: null, turnsSinceCheck: 0 };
}

export function readLearner(metadata: Record<string, unknown> | null | undefined): LearnerState {
  const value = metadata?.learner as Partial<LearnerState> | undefined;
  return value ? { ...emptyLearner(), ...value } : emptyLearner();
}

const MAX_CONCEPTS = 24;

function upsertConcept(state: LearnerState, name: string, status: TutorConceptStatus, messageId: string): LearnerState {
  const label = clean(name, 60);
  if (!label) return state;
  const key = label.toLowerCase();
  const existing = state.concepts.find((concept) => concept.name.toLowerCase() === key);
  const others = state.concepts.filter((concept) => concept !== existing);
  // "introduced" never downgrades what the learner already showed or struggled with.
  const next = existing && status === "introduced" ? existing.status : status;
  const evidence = [...(existing?.evidence ?? []), messageId].slice(-5);
  return { ...state, concepts: [...others, { name: existing?.name ?? label, status: next, evidence }].slice(-MAX_CONCEPTS) };
}

export function mergeLearner(state: LearnerState, update: TutorModelOutput["learner"], blocks: StoredBlock[], messageId: string): LearnerState {
  let next: LearnerState = {
    ...state,
    goal: update.goal ? clean(update.goal, 160) : state.goal,
    openQuestions: update.openQuestions.map((question) => clean(question, 200)).filter(nonEmpty).slice(0, 3),
    nextStep: clean(update.nextStep, 200) || state.nextStep,
    turnsSinceCheck: blocks.some((block) => block.type === "check" || block.type === "question") ? 0 : state.turnsSinceCheck + 1,
  };
  for (const concept of update.concepts) next = upsertConcept(next, concept.name, concept.status, messageId);
  return next;
}

export function recordCheck(state: LearnerState, concept: string, correct: boolean, messageId: string): LearnerState {
  const next = upsertConcept(state, concept, correct ? "demonstrated" : "struggling", messageId);
  return { ...next, checks: { correct: state.checks.correct + (correct ? 1 : 0), wrong: state.checks.wrong + (correct ? 0 : 1) }, lastCheck: { concept: clean(concept, 60), correct } };
}

/** The controller's next teaching move, handed to the model as guidance; the learner's own request still wins. */
export function suggestMove(state: LearnerState, firstTurn: boolean, replying: boolean): string {
  if (replying) return "Evaluate the learner's answer against the evidence: say whether it holds, correct the specific gap, then take one step forward.";
  if (state.lastCheck && !state.lastCheck.correct) return `Repair: the learner just missed a check on "${state.lastCheck.concept}". Re-explain it differently from the evidence, then re-check it with a new question.`;
  if (firstTurn && !state.goal) return "Answer directly if the question is specific. If it is broad, you may first ask one short question about their goal or what they already know.";
  const unchecked = state.concepts.filter((concept) => concept.status === "introduced");
  if (unchecked.length > 0 && state.turnsSinceCheck >= 2) return `Check understanding: after answering, add one short check on "${unchecked[unchecked.length - 1]!.name}".`;
  const struggling = state.concepts.find((concept) => concept.status === "struggling");
  if (struggling) return `Answer the question; where it connects, reinforce "${struggling.name}", which the learner found hard.`;
  if (state.concepts.some((concept) => concept.status === "demonstrated")) return "Answer the question. If the learner seems ready, offer a short varied practice problem from the evidence.";
  return "Answer the question clearly; end with a check if you introduced a new concept.";
}
