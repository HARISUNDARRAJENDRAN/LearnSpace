export type ResearchAffinitySignal = {
  kind: "saved" | "opened" | "reading" | "completed" | "note" | "engaged";
  occurredAt: Date;
  count?: number;
};

const signalWeight: Record<ResearchAffinitySignal["kind"], number> = {
  saved: 6,
  opened: 2,
  reading: 3,
  completed: 5,
  note: 5,
  engaged: 1,
};
const halfLifeDays = 45;

export function scoreResearchAffinity(signals: ResearchAffinitySignal[], now = new Date()): number {
  return signals.reduce((score, signal) => {
    const ageDays = Math.max(0, (now.getTime() - signal.occurredAt.getTime()) / 86_400_000);
    const recency = Math.exp((-Math.LN2 * ageDays) / halfLifeDays);
    return score + signalWeight[signal.kind] * Math.min(signal.count ?? 1, 8) * recency;
  }, 0);
}

export function scoreResearchAuthors(signals: Map<string, ResearchAffinitySignal[]>, now = new Date()): Map<string, number> {
  return new Map([...signals].map(([authorId, authorSignals]) => [authorId, scoreResearchAffinity(authorSignals, now)]));
}
