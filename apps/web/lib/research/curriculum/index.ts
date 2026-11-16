import data from "./data.json" with { type: "json" };
import {
  researchCurriculumSchema,
  type CurriculumItem,
  type CurriculumTrack,
} from "@learnspace/shared";

const curriculum = researchCurriculumSchema.parse(data);
const itemById = new Map(curriculum.items.map((item) => [item.id, item]));

export type PaperProgress = {
  status: "not-started" | "in-progress" | "completed";
  progressPct: number;
  lastOpenedAt: string | null;
};
export type PaperProgressByIdentifier = ReadonlyMap<string, PaperProgress>;
export type LearnerProfile = { selfReportedLevel: "beginner" | "intermediate" | "advanced"; interests: string[] };
export type CurriculumItemStatus = "done" | "in-progress" | "ready" | "locked-by-prereqs" | "optional";
export type ResearchTrackDag = {
  track: CurriculumTrack;
  items: CurriculumItem[];
  edges: Array<{ from: string; to: string }>;
  topologicalItemIds: string[];
};
export type PersonalizedTrackState = {
  items: Array<{ item: CurriculumItem; status: CurriculumItemStatus; progressPct: number; lastOpenedAt: string | null; waitingOn: string[] }>;
  progressPct: number;
  recommendedNext: CurriculumItem[];
  beginnerPath: CurriculumItem[];
};

const completionThreshold = 90;
const normalizeIdentifier = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\/(doi\.org\/)?/, "").replace(/^doi:/, "");

export function listResearchTracks(): CurriculumTrack[] {
  return curriculum.tracks;
}

export function getResearchTrack(trackId: string): ResearchTrackDag | null {
  const track = curriculum.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return null;
  const itemIds = [...new Set(track.modules.flatMap((module) => module.itemIds))];
  const items = itemIds.map((id) => itemById.get(id)).filter((item): item is CurriculumItem => item !== undefined);
  const included = new Set(itemIds);
  const edges = items.flatMap((item) => item.prerequisites.filter((prerequisite) => included.has(prerequisite)).map((prerequisite) => ({ from: prerequisite, to: item.id })));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const topologicalItemIds: string[] = [];
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`Curriculum dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of edges.filter((candidate) => candidate.to === id)) visit(edge.from);
    visiting.delete(id);
    visited.add(id);
    topologicalItemIds.push(id);
  };
  for (const id of itemIds) visit(id);
  return { track, items, edges, topologicalItemIds };
}

function progressFor(item: CurriculumItem, progress: PaperProgressByIdentifier): PaperProgress | undefined {
  if (item.type !== "paper") return undefined;
  for (const key of [item.arxivId, item.doi].filter((value): value is string => Boolean(value))) {
    const wanted = normalizeIdentifier(key);
    for (const [identifier, value] of progress) if (normalizeIdentifier(identifier) === wanted) return value;
  }
  return undefined;
}

type ItemState = { status: CurriculumItemStatus; progressPct: number; lastOpenedAt: string | null; waitingOn: string[] };

/**
 * Where the learner stands on one step, and the unread papers it is waiting on. Concepts are refreshers, never gates. A paper
 * from a prerequisite track gates only beginners; everyone else is assumed to know the foundations the track builds on.
 */
function itemStatus(item: CurriculumItem, byId: Map<string, { item: CurriculumItem; status: CurriculumItemStatus }>, progress: PaperProgressByIdentifier, profile: LearnerProfile): ItemState {
  const record = progressFor(item, progress);
  const progressPct = Math.min(100, Math.max(0, record?.progressPct ?? 0));
  const lastOpenedAt = record?.lastOpenedAt ?? null;
  if (record?.status === "completed" || progressPct >= completionThreshold) return { status: "done", progressPct, lastOpenedAt, waitingOn: [] };
  if (record?.status === "in-progress" || progressPct > 0) return { status: "in-progress", progressPct, lastOpenedAt, waitingOn: [] };
  const waitingOn = item.prerequisites.filter((id) => {
    const prerequisite = itemById.get(id);
    if (!prerequisite || prerequisite.type === "concept") return false;
    const inTrack = byId.get(id);
    if (inTrack) return inTrack.status !== "done";
    if (profile.selfReportedLevel !== "beginner") return false;
    const read = progressFor(prerequisite, progress);
    return !(read?.status === "completed" || (read?.progressPct ?? 0) >= completionThreshold);
  });
  return { status: waitingOn.length ? "locked-by-prereqs" : item.required ? "ready" : "optional", progressPct, lastOpenedAt, waitingOn };
}

/** A curriculum item's title, for naming what a locked step is waiting on. */
export function curriculumItemTitle(id: string): string | null {
  return itemById.get(id)?.title ?? null;
}

export function computeResearchTrackState(
  trackId: string,
  progress: PaperProgressByIdentifier,
  profile: LearnerProfile,
): PersonalizedTrackState | null {
  const dag = getResearchTrack(trackId);
  if (!dag) return null;
  const stateById = new Map<string, { item: CurriculumItem; status: CurriculumItemStatus }>();
  const states: PersonalizedTrackState["items"] = [];
  for (const id of dag.topologicalItemIds) {
    const item = itemById.get(id)!;
    const result = itemStatus(item, stateById, progress, profile);
    stateById.set(id, { item, status: result.status });
    states.push({ item, ...result });
  }
  const requiredPapers = states.filter((entry) => entry.item.type === "paper" && entry.item.required);
  const completed = requiredPapers.filter((entry) => entry.status === "done").length;
  const interests = profile.interests.map((interest) => interest.toLowerCase()).filter(Boolean);
  const interestScore = (item: CurriculumItem) => interests.filter((interest) => [item.title, ...item.keyConcepts].some((text) => text.toLowerCase().includes(interest))).length;
  const levelScore = (item: CurriculumItem) => profile.selfReportedLevel === "beginner"
    ? ({ beginner: 3, intermediate: 2, advanced: 0 }[item.difficulty] ?? 0)
    : profile.selfReportedLevel === "advanced" ? ({ advanced: 3, intermediate: 2, beginner: 1 }[item.difficulty] ?? 0) : 1;
  const recommendedNext = states.filter((entry) => entry.status === "ready" || entry.status === "optional")
    .sort((a, b) => Number(b.item.required) - Number(a.item.required) || (interestScore(b.item) - interestScore(a.item)) || (levelScore(b.item) - levelScore(a.item)) || dag.topologicalItemIds.indexOf(a.item.id) - dag.topologicalItemIds.indexOf(b.item.id))
    .slice(0, 3).map((entry) => entry.item);
  const beginnerPath = dag.topologicalItemIds.map((id) => itemById.get(id)!).filter((item) => item.type === "concept" || item.required);
  return { items: states, progressPct: requiredPapers.length ? Math.round((completed / requiredPapers.length) * 100) : 0, recommendedNext, beginnerPath };
}
