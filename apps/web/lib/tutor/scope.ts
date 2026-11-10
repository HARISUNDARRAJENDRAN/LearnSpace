/** Which part of the video a question is about, read from its wording and the learner's playback position. */
export type TutorScope =
  | { kind: "near" | "at"; fromMs: number; toMs: number; focusMs: number; key: string }
  | { kind: "watched"; fromMs: 0; toMs: number; focusMs: null; key: string }
  | { kind: "whole" | "default"; fromMs: null; toMs: null; focusMs: number | null; key: string }
  | { kind: "out_of_range"; requestedMs: number; key: string };

const NEAR = /\b(just (?:said|says|now|explained|mentioned|showed|did|covered)|right now|this part|this bit|this section|this step|at this point|a (?:moment|second|minute) ago|currently)\b/i;
const WATCHED = /\b(so far|until now|up to (?:here|now|this point)|i(?:'ve| have) (?:watched|seen)|what i(?:'ve)? (?:watched|seen))\b/i;
const WHOLE = /\b(entire|whole|full|complete|overall)\b[^.?!]{0,30}\b(video|lecture|lesson|talk|course|episode)\b|\bsummar(?:y|ize|ise) (?:of )?(?:the|this) (?:video|lecture|lesson|talk)\b/i;
const CLOCK = /\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/;
const MINUTE = /\b(?:minute|min)\s+(\d{1,3})\b|\b(\d{1,3})\s*(?:minutes?|mins?)\s+(?:in|mark)\b/i;
// Captions may run a little past the reported length; asking far past it is a mistake to clarify.
const RANGE_SLACK_MS = 30_000;

export function requestedTimeMs(question: string): number | null {
  const clock = CLOCK.exec(question);
  if (clock) {
    const [hours, minutes, seconds] = [Number(clock[1] ?? 0), Number(clock[2]), Number(clock[3])];
    if (seconds < 60 && (clock[1] === undefined || minutes < 60)) return ((hours * 60 + minutes) * 60 + seconds) * 1_000;
  }
  const minute = MINUTE.exec(question);
  return minute ? Number(minute[1] ?? minute[2]) * 60_000 : null;
}

export function resolveScope(question: string, positionMs: number, durationMs: number | null): TutorScope {
  const requested = requestedTimeMs(question);
  if (requested !== null) {
    if (durationMs && requested > durationMs + RANGE_SLACK_MS) return { kind: "out_of_range", requestedMs: requested, key: "out_of_range" };
    return { kind: "at", fromMs: Math.max(0, requested - 90_000), toMs: requested + 90_000, focusMs: requested, key: `at:${Math.floor(requested / 30_000)}` };
  }
  if (WATCHED.test(question)) return { kind: "watched", fromMs: 0, toMs: positionMs, focusMs: null, key: `watched:${Math.floor(positionMs / 60_000)}` };
  if (NEAR.test(question)) return { kind: "near", fromMs: Math.max(0, positionMs - 150_000), toMs: positionMs + 15_000, focusMs: positionMs, key: `near:${Math.floor(positionMs / 30_000)}` };
  if (WHOLE.test(question)) return { kind: "whole", fromMs: null, toMs: null, focusMs: null, key: "whole" };
  return { kind: "default", fromMs: null, toMs: null, focusMs: positionMs, key: `default:${Math.floor(positionMs / 120_000)}` };
}

const STOPWORDS = new Set("the a an and or but if then than that this these those what which who whom whose when where why how is are was were be been being do does did have has had of in on at to for from by with about into over under again further can could should would will shall may might must not no nor so too very just also only own same such some any each few more most other both all there here it its it's they them their he him his she her we us our you your i me my mine explain explains explained tell say said says mean means meant video lecture lesson instructor speaker talk part please".split(" "));

/** The question's content words, lowercased and without stopwords. */
export function questionTerms(question: string): string[] {
  const words = question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((word) => word.length >= 3 && !STOPWORDS.has(word)))].slice(0, 12);
}

/** The terms as an OR prefix query for PostgreSQL's `simple` text search; empty when nothing is left. */
export function lexicalQuery(terms: string[]): string {
  return terms.map((term) => `${term}:*`).join(" | ");
}

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1_000);
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}
