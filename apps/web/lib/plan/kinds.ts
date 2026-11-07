// Kinds of study; each has its own colour on the calendar. Client-safe, so the UI shares it with the service.
export const PLAN_KINDS = ["watch", "read", "practice", "review"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const kindLabel: Record<PlanKind, string> = { watch: "Watch", read: "Read", practice: "Practice", review: "Review" };

// The kind a piece of material suggests; the learner can still pick another.
export function kindForResource(type: string): PlanKind {
  return type === "video" ? "watch" : type === "code" ? "practice" : "read";
}
