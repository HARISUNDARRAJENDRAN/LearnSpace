// Kinds of study; each has its own colour on the calendar. Client-safe, so the UI shares it with the service.
export const PLAN_KINDS = ["watch", "read", "practice", "review"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const kindLabel: Record<PlanKind, string> = { watch: "Watch", read: "Read", practice: "Practice", review: "Review" };

// The kind a piece of material suggests; the learner can still pick another.
export function kindForResource(type: string): PlanKind {
  return type === "video" ? "watch" : type === "code" ? "practice" : "read";
}

// Words that name a kind outright, checked in this order; "review the practice set" is a review.
const kindWords: [PlanKind, RegExp][] = [
  ["review", /\b(review|revise|revision|recap|go over|flash ?cards?|summari[sz]e|re-?watch)\b/i],
  ["practice", /\b(practi[cs]e|exercises?|solve|problems?|implement|build|code|coding|quiz|leetcode|project|drills?)\b/i],
  ["read", /\b(read|reading|paper|article|chapter|book|docs|documentation|pdf|notes)\b/i],
  ["watch", /\b(watch|video|lecture|talk|tutorial|course)\b/i],
];

// The kind a free-text plan names, or null when the words do not say.
export function kindFromWords(text: string): PlanKind | null {
  return kindWords.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}
