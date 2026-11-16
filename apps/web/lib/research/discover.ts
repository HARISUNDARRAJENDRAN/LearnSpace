import { withUserTransaction } from "@learnspace/db";
import { concepts, paperDetails, resources, userResourceProgress, userSettings } from "@learnspace/db/schema";
import type { CurriculumItem, CurriculumTrack } from "@learnspace/shared";
import { onboardingDraftSchema } from "@learnspace/shared";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { computeResearchTrackState, curriculumItemTitle, getResearchTrack, listResearchTracks, type CurriculumItemStatus, type LearnerProfile, type PaperProgress } from "./curriculum";

export type DiscoverItem = { item: CurriculumItem; status: CurriculumItemStatus; progressPct: number; resourceId: string | null; recommended: boolean; waitingOn: string[] };
export type DiscoverTrackSummary = {
  track: CurriculumTrack;
  paperCount: number;
  conceptCount: number;
  progressPct: number;
  started: boolean;
  next: CurriculumItem | null;
};
export type ResearchDiscoverData = { tracks: DiscoverTrackSummary[]; recommendedTrackId: string | null };
export type ResearchTrackPageData = {
  summary: DiscoverTrackSummary;
  modules: Array<{ id: string; title: string; items: DiscoverItem[] }>;
  edges: Array<{ from: string; to: string }>;
  nextTracks: CurriculumTrack[];
  buildsOn: CurriculumTrack[];
};

const curriculumArxivIds = () => [...new Set(listResearchTracks().flatMap((track) => getResearchTrack(track.id)?.items ?? []).flatMap((item) => item.type === "paper" ? [item.arxivId] : []))];

/** The learner's level and interests, plus their progress and the catalogue resource for every curriculum paper (by arXiv id). */
async function learnerState(userId: string) {
  return withUserTransaction(userId, async (tx) => {
    const ids = curriculumArxivIds();
    const [settings, rows] = await Promise.all([
      tx.select({ learningPreferences: userSettings.learningPreferences }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
      ids.length ? tx.select({ arxivId: paperDetails.arxivId, resourceId: resources.id, status: userResourceProgress.status, progressPct: userResourceProgress.progressPct, lastOpenedAt: userResourceProgress.lastOpenedAt })
        .from(paperDetails)
        .innerJoin(resources, eq(resources.id, paperDetails.resourceId))
        .leftJoin(userResourceProgress, and(eq(userResourceProgress.resourceId, resources.id), eq(userResourceProgress.userId, userId)))
        .where(and(inArray(paperDetails.arxivId, ids), isNull(resources.deletedAt), or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"])))) : Promise.resolve([]),
    ]);
    const draft = onboardingDraftSchema.safeParse(settings[0]?.learningPreferences ?? {});
    const conceptIds = draft.success ? draft.data.conceptIds ?? [] : [];
    const interestRows = conceptIds.length ? await tx.select({ name: concepts.name }).from(concepts).where(inArray(concepts.id, conceptIds)) : [];
    const level = draft.success ? draft.data.selfReportedLevel : undefined;
    const profile: LearnerProfile = { selfReportedLevel: level === "beginner" || level === "advanced" ? level : "intermediate", interests: interestRows.map(({ name }) => name) };
    const progress = new Map<string, PaperProgress>();
    const resourceByArxiv = new Map<string, string>();
    for (const row of rows) {
      if (!row.arxivId) continue;
      resourceByArxiv.set(row.arxivId, row.resourceId);
      if (row.status) progress.set(row.arxivId, { status: row.status === "completed" ? "completed" : Number(row.progressPct ?? 0) > 0 ? "in-progress" : "not-started", progressPct: Number(row.progressPct ?? 0), lastOpenedAt: row.lastOpenedAt?.toISOString() ?? null });
    }
    return { profile, progress, resourceByArxiv };
  });
}

function summarise(track: CurriculumTrack, state: NonNullable<ReturnType<typeof computeResearchTrackState>>): DiscoverTrackSummary {
  return {
    track,
    paperCount: state.items.filter(({ item }) => item.type === "paper").length,
    conceptCount: state.items.filter(({ item }) => item.type === "concept").length,
    progressPct: state.progressPct,
    started: state.items.some(({ status }) => status === "done" || status === "in-progress"),
    next: state.recommendedNext[0] ?? null,
  };
}

/** How well a track fits the learner: their interests, then their level (beginners start from the foundations). */
function fit(track: CurriculumTrack, items: CurriculumItem[], profile: LearnerProfile) {
  const text = [track.title, ...items.flatMap((item) => item.keyConcepts)].join(" ").toLowerCase();
  const interest = profile.interests.filter((interest) => text.includes(interest.toLowerCase())).length;
  const foundations = track.prerequisiteTrackIds.length === 0 ? 1 : 0;
  return interest * 2 + (profile.selfReportedLevel === "beginner" ? foundations * 3 : 0);
}

export async function getResearchDiscover(userId: string): Promise<ResearchDiscoverData> {
  const { profile, progress } = await learnerState(userId);
  const tracks = listResearchTracks().flatMap((track) => {
    const state = computeResearchTrackState(track.id, progress, profile);
    return state ? [{ summary: summarise(track, state), fit: fit(track, state.items.map(({ item }) => item), profile) }] : [];
  });
  // A path already under way comes first; otherwise the best fit.
  const recommended = [...tracks].sort((a, b) => Number(b.summary.started && b.summary.progressPct < 100) - Number(a.summary.started && a.summary.progressPct < 100) || b.fit - a.fit)[0];
  return { tracks: tracks.map(({ summary }) => summary), recommendedTrackId: recommended?.summary.track.id ?? null };
}

export async function getResearchTrackPage(userId: string, trackId: string): Promise<ResearchTrackPageData | null> {
  const dag = getResearchTrack(trackId);
  if (!dag) return null;
  const { profile, progress, resourceByArxiv } = await learnerState(userId);
  const state = computeResearchTrackState(trackId, progress, profile);
  if (!state) return null;
  const recommended = new Set(state.recommendedNext.map(({ id }) => id));
  const byId = new Map(state.items.map((entry) => [entry.item.id, entry]));
  const all = listResearchTracks();
  return {
    summary: summarise(dag.track, state),
    modules: dag.track.modules.map((module) => ({
      id: module.id,
      title: module.title,
      items: module.itemIds.flatMap((id) => {
        const entry = byId.get(id);
        return entry ? [{ item: entry.item, status: entry.status, progressPct: entry.progressPct, resourceId: entry.item.type === "paper" ? resourceByArxiv.get(entry.item.arxivId) ?? null : null, recommended: recommended.has(id), waitingOn: entry.waitingOn.flatMap((prerequisite) => curriculumItemTitle(prerequisite) ?? []) }] : [];
      }),
    })),
    edges: dag.edges,
    nextTracks: dag.track.nextTrackIds.flatMap((id) => all.filter((track) => track.id === id)),
    buildsOn: dag.track.prerequisiteTrackIds.flatMap((id) => all.filter((track) => track.id === id)),
  };
}
