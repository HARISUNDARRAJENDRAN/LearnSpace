import { RECOMMENDATION_CONFIG as config } from "./recommendation-config.js";
/** Typed observations project into userConceptAffinity; clicks never imply learning. */
export const LEARNER_MODEL_VERSION = "discovery-behavior-v2";
export const AFFINITY_HALF_LIFE_DAYS = 45;

export type LearnerAffinity = {
  conceptId: string;
  score: number;
  confidence: number;
  positiveWeight?: number;
  negativeWeight?: number;
  featureVersion: string;
  lastEventAt?: Date | null;
  updatedAt?: Date | null;
};

export type LearnerObservation =
  | { kind: "open" | "save" | "start_session" | "dismiss" | "question" | "exercise" }
  | { kind: "consumption"; seconds: number; totalSeconds: number; rewatch: boolean }
  | { kind: "progress" | "complete"; progress: number; watchedSeconds: number }
  | { kind: "abandon"; progress: number; watchedSeconds: number };

export type BehaviorSignal = { positive: number; negative: number; confidence: number; refresh: boolean };

export function behaviorSignal(observation: LearnerObservation): BehaviorSignal {
  let positive = 0;
  let negative = 0;
  switch (observation.kind) {
    case "open": break;
    case "save": positive = config.signals.save; break;
    case "start_session": positive = config.signals.session; break;
    case "dismiss": negative = config.signals.dismiss; break;
    case "question": positive = config.signals.question; break;
    case "exercise": positive = config.signals.exercise; break;
    case "consumption":
      if (Number.isFinite(observation.seconds) && Number.isFinite(observation.totalSeconds) && observation.totalSeconds >= config.signals.minimumWatchSeconds) positive = Math.min(30, Math.max(0, observation.seconds)) / 60 * (observation.rewatch ? config.signals.rewatch : config.signals.consumption);
      break;
    case "progress":
    case "complete":
      if (Number.isFinite(observation.watchedSeconds) && Number.isFinite(observation.progress) && observation.watchedSeconds >= config.signals.minimumWatchSeconds && observation.progress >= .25) positive = observation.kind === "complete" ? config.signals.complete : config.signals.progress * observation.progress;
      break;
    case "abandon":
      if (Number.isFinite(observation.watchedSeconds) && Number.isFinite(observation.progress) && observation.watchedSeconds >= 0 && observation.watchedSeconds < config.signals.abandonmentSeconds && observation.progress >= 0 && observation.progress < .1) negative = config.signals.abandon;
      break;
  }
  return { positive, negative, confidence: positive + negative, refresh: positive >= config.significantEvidence };
}

export function affinityDecay(affinity: LearnerAffinity, now: Date): number {
  const date = affinity.lastEventAt ?? affinity.updatedAt;
  return date ? .5 ** (Math.max(0, now.getTime() - date.getTime()) / (AFFINITY_HALF_LIFE_DAYS * 86_400_000)) : 1;
}

export function observedAffinity(affinity: LearnerAffinity | undefined, now: Date): { score: number; confidence: number; evidence: number } {
  if (!affinity?.featureVersion.includes("behavior")) return { score: 0, confidence: 0, evidence: 0 };
  const decay = affinityDecay(affinity, now);
  return {
    score: affinity.score * decay,
    confidence: affinity.confidence * decay,
    evidence: ((affinity.positiveWeight ?? 0) + (affinity.negativeWeight ?? 0)) * decay,
  };
}

export function updateBehaviorAffinity(previous: LearnerAffinity | undefined, signal: BehaviorSignal, now: Date) {
  const decay = previous?.featureVersion.includes("behavior") ? affinityDecay(previous, now) : 0;
  const positiveWeight = (previous?.positiveWeight ?? 0) * decay + signal.positive;
  const negativeWeight = (previous?.negativeWeight ?? 0) * decay + signal.negative;
  const evidence = positiveWeight + negativeWeight;
  return {
    positiveWeight,
    negativeWeight,
    score: (positiveWeight - negativeWeight) / (1 + evidence),
    confidence: .95 * (1 - Math.exp(-evidence / 1.5)),
    featureVersion: LEARNER_MODEL_VERSION,
    lastEventAt: now,
    updatedAt: now,
  };
}

export function personalizationWeights(affinities: Iterable<LearnerAffinity>, onboardingAt: Date | null | undefined, now: Date) {
  const evidence = [...affinities].reduce((total, affinity) => total + observedAffinity(affinity, now).evidence, 0);
  const behavior = Math.min(.92, evidence / (evidence + 2));
  const age = onboardingAt ? Math.max(0, now.getTime() - onboardingAt.getTime()) / 86_400_000 : 0;
  return { behavior, onboarding: (1 - behavior) * (.15 + .85 * .5 ** (age / 180)), evidence };
}


export type CompactLearningState = {
  longTermInterests: Record<string, number>;
  recentInterests: Record<string, number>;
  longTermVector: number[] | null;
  recentVector: number[] | null;
  evidence: number;
  updatedAt: string;
};

export function validVector(value: unknown, dimensions = config.embeddingDimensions): value is number[] {
  return Array.isArray(value) && value.length === dimensions && value.every((n) => typeof n === "number" && Number.isFinite(n)) && value.some((n) => n !== 0);
}

export function normalizeVector(vector: number[]): number[] {
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0) throw new Error("Embedding must be finite and nonzero");
  return vector.map((value) => value / norm);
}

export function updateVector(previous: number[] | null, resource: number[], strength: number): number[] {
  if (!validVector(resource)) throw new Error("Invalid resource embedding");
  if (!previous) return normalizeVector(resource);
  if (!validVector(previous)) throw new Error("Invalid learner embedding");
  const alpha = Math.min(config.vectorMaximumAlpha, Math.max(0, strength));
  if (alpha === 0) return previous;
  const blended = previous.map((value, index) => value * (1 - alpha) + resource[index]! * alpha);
  return blended.some((value) => value !== 0) ? normalizeVector(blended) : previous;
}

export function retrievalVector(state: CompactLearningState): number[] | null {
  const recent = validVector(state.recentVector) ? state.recentVector : null;
  const longTerm = validVector(state.longTermVector) ? state.longTermVector : null;
  if (!recent) return longTerm;
  if (!longTerm) return recent;
  const recentAge = Math.max(0, Date.now() - Date.parse(state.updatedAt)) / 86400000;
  const recentWeight = config.recentShare * (state.evidence / (state.evidence + config.recentEvidenceScale)) * .5 ** (recentAge / config.recentHalfLifeDays);
  const blended = recent.map((value, index) => value * recentWeight + longTerm[index]! * config.longTermShare);
  return blended.some((value) => value !== 0) ? normalizeVector(blended) : longTerm;
}

export function updateLearningState(previous: CompactLearningState, observation: LearnerObservation, conceptWeights: Record<string, number>, resourceVector: number[] | null, now: Date): CompactLearningState {
  const signal = behaviorSignal(observation);
  if (!signal.positive && !signal.negative) return previous;
  const effectiveTime = Math.max(now.getTime(), Date.parse(previous.updatedAt));
  const lag = Math.max(0, effectiveTime - now.getTime()) / 86400000;
  const age = Math.max(0, effectiveTime - Date.parse(previous.updatedAt)) / 86400000;
  const updateInterests = (values: Record<string, number>, halfLife: number) => {
    const updated: Record<string, number> = Object.fromEntries(Object.entries(values).map(([id, weight]) => [id, weight * .5 ** (age / halfLife)]));
    for (const [id, relevance] of Object.entries(conceptWeights)) {
      const contribution = (signal.positive - signal.negative * config.negativeInterestShare) * Math.max(0, Math.min(1, relevance)) * .5 ** (lag / halfLife);
      updated[id] = Math.max(0, Math.min(config.maximumInterest, (updated[id] ?? 0) + contribution));
    }
    return Object.fromEntries(Object.entries(updated).filter(([, weight]) => weight > config.interestFloor).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, config.profileTopicLimit));
  };
  const positiveVector = resourceVector && signal.positive > 0;
  return {
    longTermInterests: updateInterests(previous.longTermInterests, config.longTermHalfLifeDays),
    recentInterests: updateInterests(previous.recentInterests, config.recentHalfLifeDays),
    longTermVector: positiveVector ? updateVector(previous.longTermVector, resourceVector, signal.positive * config.longTermVectorAlphaScale * .5 ** (lag / config.longTermHalfLifeDays)) : previous.longTermVector,
    recentVector: positiveVector ? updateVector(previous.recentVector, resourceVector, signal.positive * .5 ** (lag / config.recentHalfLifeDays)) : previous.recentVector,
    evidence: previous.evidence + signal.positive * .5 ** (lag / config.longTermHalfLifeDays),
    updatedAt: new Date(effectiveTime).toISOString(),
  };
}


export function observationFromActivity(eventType: string, payload: Record<string, unknown>): LearnerObservation | null {
  const progress = Number(payload.progressPct ?? Number(payload.progressFraction ?? payload.progress ?? 0) * 100) / 100;
  const watchedSeconds = Number(payload.watchedSeconds ?? 0);
  switch (eventType) {
    case "resource.opened": return { kind: payload.intent === "start" ? "start_session" : "open" };
    case "session.started": return { kind: "start_session" };
    case "resource.saved": return { kind: "save" };
    case "discovery.dismissed": return { kind: "dismiss" };
    case "question.asked": return { kind: "question" };
    case "exercise.completed": case "review.completed": return { kind: "exercise" };
    case "resource.consumed": return { kind: "consumption", seconds: Number(payload.durationSeconds ?? 0), totalSeconds: watchedSeconds, rewatch: payload.rewatch === true };
    case "resource.progressed": return payload.milestone ? { kind: "progress", progress, watchedSeconds } : null;
    case "resource.completed": return { kind: "complete", progress, watchedSeconds };
    case "resource.abandoned": return { kind: "abandon", progress, watchedSeconds };
    default: return null;
  }
}
