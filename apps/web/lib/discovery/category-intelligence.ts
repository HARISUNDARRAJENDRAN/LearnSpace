import { createHash } from "node:crypto";
import type { CurriculumCategory, CurriculumItem } from "./curriculum";
import { categoryEditorial, type EditorialClaim } from "./category-editorial";
import generated from "./generated/category-intelligence.json";

export const categoryIntelligenceVersion = "category-editorial-v5";

type Evidence = { resourceUrl: string; field: "track" | "title" | "coverageNotes" | "channel"; value: string };
export type CurriculumObservation = {
  kind: EditorialClaim["kind"];
  text: string;
  evidence: Evidence[];
  // Absence means absent from the catalogue metadata, never absent from the actual lessons.
  absenceCheck?: { pattern: string; inspectedResourceUrls: string[] };
};

export type CategoryCurriculumAnalysis = {
  version: string;
  fingerprint: string;
  categorySlug: string;
  curriculumType: "sequential" | "exploratory" | "hybrid";
  resourceRoles: {
    resourceUrl: string;
    title: string;
    role: string | null;
    stage: string | null;
    topics: string[];
  }[];
  topicMap: { topic: string; resourceUrls: string[]; stages: string[] }[];
  observations: CurriculumObservation[];
  learningProgression: string[];
  complementaryRelationships: CurriculumObservation[];
  intentionalOverlap: CurriculumObservation[];
  coverageGaps: CurriculumObservation[];
  tradeoffs: CurriculumObservation[];
  editorial: {
    paragraphs: string[];
    insight: string | null;
    approach: string | null;
    startingPoint: { title: string; url: string } | null;
  };
};

function resourcesFor(category: CurriculumCategory): CurriculumItem[] {
  return category.items.filter((item) => item.url && ["video", "playlist"].includes(item.resourceType));
}

export function categoryIntelligenceFingerprint(category: CurriculumCategory): string {
  return createHash("sha256").update(JSON.stringify({
    version: categoryIntelligenceVersion,
    category: { slug: category.slug, name: category.name },
    editorial: categoryEditorial[category.slug] ?? null,
    // Preserve curated order. Row IDs and thumbnails are presentation details, not curriculum evidence.
    resources: resourcesFor(category).map(({ title, channel, url, resourceType, curriculumRole, learningStage, track, coverageNotes, publishedOrUpdated, language }) => ({
      title, channel, url, resourceType, curriculumRole, learningStage, track, coverageNotes,
      publishedOrUpdated: publishedOrUpdated ?? null, language: language ?? null,
    })),
  })).digest("hex");
}

function groundClaim(claim: EditorialClaim, resources: CurriculumItem[]): CurriculumObservation | null {
  if (resources.length < (claim.minResources ?? 2)) return null;
  for (const [track, count] of Object.entries(claim.minimumTrackCounts ?? {})) {
    if (new Set(resources.filter((item) => item.track === track).map((item) => item.url)).size < count) return null;
  }
  const evidence: Evidence[] = [];
  for (const [field, requirements] of [
    ["track", claim.tracks], ["title", claim.titles ?? []], ["coverageNotes", claim.notes ?? []], ["channel", claim.channels ?? []],
  ] as const) {
    for (const requirement of requirements) {
      const matches = resources.filter((item) => field === "track"
        ? item[field] === requirement
        : item[field]?.toLocaleLowerCase().includes(requirement.toLocaleLowerCase()));
      if (!matches.length) return null;
      evidence.push(...matches.map((item) => ({ resourceUrl: item.url!, field, value: item[field]! })));
    }
  }
  if (!evidence.length) return null;
  if (claim.absent && resources.some((item) => new RegExp(claim.absent!, "i").test([item.title, item.track, item.coverageNotes].join(" ")))) return null;
  return {
    kind: claim.kind, text: claim.text, evidence,
    ...(claim.absent ? { absenceCheck: { pattern: claim.absent, inspectedResourceUrls: resources.map((item) => item.url!) } } : {}),
  };
}

export function analyzeCategoryCurriculum(category: CurriculumCategory): CategoryCurriculumAnalysis {
  const resources = resourcesFor(category);
  const spec = categoryEditorial[category.slug];
  const observations = (spec?.claims ?? []).flatMap((claim) => {
    const observation = groundClaim(claim, resources);
    return observation ? [observation] : [];
  });
  const topics = [...new Set(resources.flatMap((item) => item.track ? [item.track] : []))];
  const topicMap = topics.map((topic) => {
    const matching = resources.filter((item) => item.track === topic);
    return { topic, resourceUrls: matching.map((item) => item.url!), stages: [...new Set(matching.flatMap((item) => item.learningStage ? [item.learningStage] : []))] };
  });
  if (spec && observations.length) {
    const interpretedTracks = new Set([...spec.claims, spec.insight, spec.approach].flatMap((item) => item.tracks).concat(spec.contextTracks ?? []));
    const otherTracks = topicMap.filter((item) => !interpretedTracks.has(item.topic));
    if (otherTracks.length) observations.push({
      kind: "complement",
      text: `The remaining tracks—${otherTracks.map((item) => item.topic.toLocaleLowerCase()).join(", ")}—extend the scope beyond that route. Choose one for a concrete question rather than treating every branch as a required next step.`,
      evidence: resources.filter((item) => item.track && otherTracks.some((topic) => topic.topic === item.track)).map((item) => ({ resourceUrl: item.url!, field: "track", value: item.track! })),
    });
  }
  const structure = observations.find((item) => item.kind === "structure");
  const approach = spec?.approach ? groundClaim(spec.approach, resources) : null;
  const insight = spec?.insight ? groundClaim(spec.insight, resources) : null;
  const startingPoint = approach && spec?.startTrack ? resources.find((item) => item.track === spec.startTrack) : null;
  const analysis: CategoryCurriculumAnalysis = {
    version: categoryIntelligenceVersion,
    fingerprint: categoryIntelligenceFingerprint(category),
    categorySlug: category.slug,
    curriculumType: structure ? spec!.curriculumType : "exploratory",
    resourceRoles: resources.map((item) => ({ resourceUrl: item.url!, title: item.title, role: item.curriculumRole, stage: item.learningStage, topics: item.track ? [item.track] : [] })),
    topicMap,
    observations: [...observations, ...(insight ? [insight] : []), ...(approach ? [approach] : [])],
    learningProgression: approach ? [approach.text] : [],
    complementaryRelationships: observations.filter((item) => item.kind === "complement"),
    intentionalOverlap: observations.filter((item) => item.kind === "overlap"),
    coverageGaps: observations.filter((item) => item.kind === "gap"),
    tradeoffs: observations.filter((item) => item.kind === "tradeoff"),
    editorial: { paragraphs: [], insight: insight?.text ?? null, approach: approach?.text ?? null, startingPoint: startingPoint ? { title: startingPoint.title, url: startingPoint.url! } : null },
  };
  // Copy is compiled from grounded observations only; there is no title-to-prose model call.
  analysis.editorial.paragraphs = observations.map((item) => item.text);
  // A syllabus lists core resources unit by unit, in teaching order.
  const units = resources.filter((item) => item.curriculumRole === "Core" && item.track);
  const unitTracks = units.map((item) => item.track!).filter((track, index, tracks) => track !== tracks[index - 1]);
  const isSyllabus = unitTracks.length >= 4 && new Set(unitTracks).size === unitTracks.length;
  if (resources.length === 0) {
    analysis.editorial.paragraphs = ["This collection has no available lessons yet."];
  } else if (!analysis.editorial.paragraphs.length && isSyllabus) {
    analysis.curriculumType = "sequential";
    analysis.learningProgression = unitTracks;
    // One short paragraph: it is the summary shown over the course page's hero.
    analysis.editorial.paragraphs = [`This syllabus runs in ${unitTracks.length} units, from “${unitTracks[0]}” to “${unitTracks.at(-1)}”, each building on the one before, so take them in order.`];
    analysis.editorial.approach = "Start at unit 1 and continue in order. When a later unit leans on an earlier one, go back to that unit before moving on.";
    analysis.editorial.startingPoint = { title: units[0]!.title, url: units[0]!.url! };
  } else if (resources.length === 1 || !analysis.editorial.paragraphs.length) {
    const first = resources[0]!;
    if (resources.length === 1) {
      analysis.editorial.paragraphs = [`“${first.title}” is the collection’s current anchor${first.track ? ` for ${first.track.toLocaleLowerCase()}` : ""}. One resource does not establish a broader learning progression.`, ...(first.coverageNotes ? [first.coverageNotes] : [])];
    } else {
      const overlapping = topicMap.find((topic) => topic.resourceUrls.length > 1);
      analysis.editorial.paragraphs = [
        topics.length ? `The current resources span ${topics.slice(0, 4).join(", ")}${topics.length > 4 ? ", among other tracks" : ""}. These are branches to explore; the available metadata does not establish a required order.` : `“${first.title}” and “${resources[1]!.title}” are part of this collection. There is not enough topic or coverage information to explain a dependable progression yet.`,
        ...(overlapping ? [`${overlapping.topic} appears in more than one resource. Compare those treatments or choose one; a shared topic alone does not establish that both are necessary.`] : []),
      ];
    }
  }
  return analysis;
}

const cached = new Map<string, CategoryCurriculumAnalysis>();

export function getCategoryIntelligence(category: CurriculumCategory): CategoryCurriculumAnalysis {
  const fingerprint = categoryIntelligenceFingerprint(category);
  const current = cached.get(category.slug);
  if (current?.fingerprint === fingerprint) return current;
  const persisted = (generated as Record<string, CategoryCurriculumAnalysis>)[category.slug];
  const analysis = persisted?.fingerprint === fingerprint ? persisted : analyzeCategoryCurriculum(category);
  cached.set(category.slug, analysis);
  return analysis;
}
