import { z } from "zod";

export const curriculumDifficultySchema = z.enum(["beginner", "intermediate", "advanced"]);
export const codingApplicabilitySchema = z.enum(["cpu-plausible", "project-guide"]);

export const curriculumPaperSchema = z.object({
  id: z.string().min(1),
  stageId: z.string().min(1),
  type: z.literal("paper"),
  arxivId: z.string().regex(/^\d{4}\.\d{4,5}$/),
  doi: z.string().nullable(),
  title: z.string().min(1),
  authors: z.array(z.string().min(1)).min(1),
  year: z.number().int().min(1900),
  venue: z.string().nullable(),
  url: z.string().url(),
  verifiedAt: z.string().datetime(),
  verifiedSource: z.literal("arXiv API"),
  why: z.string().min(20),
  difficulty: curriculumDifficultySchema,
  keyConcepts: z.array(z.string().min(1)).min(1),
  prerequisites: z.array(z.string()),
  required: z.boolean(),
  codingApplicability: codingApplicabilitySchema,
});

export const curriculumConceptSchema = z.object({
  id: z.string().min(1),
  stageId: z.string().min(1),
  type: z.literal("concept"),
  title: z.string().min(1),
  why: z.string().min(20),
  difficulty: curriculumDifficultySchema,
  keyConcepts: z.array(z.string().min(1)).min(1),
  prerequisites: z.array(z.string()),
  required: z.boolean(),
  codingApplicability: codingApplicabilitySchema,
});

export const curriculumItemSchema = z.discriminatedUnion("type", [curriculumPaperSchema, curriculumConceptSchema]);

export const curriculumModuleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  stageId: z.string().min(1),
  itemIds: z.array(z.string().min(1)).min(1),
});

export const curriculumTrackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  audience: z.string().min(1),
  assumedKnowledge: z.array(z.string()),
  outcomes: z.array(z.string().min(1)).min(1),
  estimatedHours: z.number().positive(),
  modules: z.array(curriculumModuleSchema).min(1),
  nextTrackIds: z.array(z.string()),
  /** Tracks this one builds on instead of repeating them; their items may be prerequisites here. */
  prerequisiteTrackIds: z.array(z.string()),
});

export const researchCurriculumSchema = z.object({
  version: z.literal(1),
  stages: z.array(z.object({ id: z.string(), title: z.string(), order: z.number().int().nonnegative() })).min(1),
  items: z.array(curriculumItemSchema).min(1),
  tracks: z.array(curriculumTrackSchema).min(1),
}).superRefine((curriculum, ctx) => {
  const itemIds = new Set<string>();
  const stageIds = new Set(curriculum.stages.map((stage) => stage.id));
  const trackIds = new Set(curriculum.tracks.map((track) => track.id));
  const itemById = new Map(curriculum.items.map((item) => [item.id, item]));
  for (const [index, item] of curriculum.items.entries()) {
    if (itemIds.has(item.id)) ctx.addIssue({ code: "custom", path: ["items", index, "id"], message: `Duplicate item id ${item.id}` });
    itemIds.add(item.id);
    if (!stageIds.has(item.stageId)) ctx.addIssue({ code: "custom", path: ["items", index, "stageId"], message: `Unknown stage ${item.stageId}` });
    for (const prerequisite of item.prerequisites) if (!itemById.has(prerequisite)) ctx.addIssue({ code: "custom", path: ["items", index, "prerequisites"], message: `Unknown prerequisite ${prerequisite}` });
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) {
      ctx.addIssue({ code: "custom", path: ["items"], message: `Prerequisite cycle includes ${id}` });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prerequisite of itemById.get(id)?.prerequisites ?? []) if (itemById.has(prerequisite)) visit(prerequisite);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of itemById.keys()) visit(id);
  for (const [trackIndex, track] of curriculum.tracks.entries()) {
    if (!trackIds.has(track.id) || curriculum.tracks.findIndex((candidate) => candidate.id === track.id) !== trackIndex) ctx.addIssue({ code: "custom", path: ["tracks", trackIndex, "id"], message: `Duplicate track id ${track.id}` });
    for (const nextTrackId of track.nextTrackIds) if (!trackIds.has(nextTrackId)) ctx.addIssue({ code: "custom", path: ["tracks", trackIndex, "nextTrackIds"], message: `Unknown next track ${nextTrackId}` });
    for (const prerequisiteTrackId of track.prerequisiteTrackIds) if (!trackIds.has(prerequisiteTrackId) || prerequisiteTrackId === track.id) ctx.addIssue({ code: "custom", path: ["tracks", trackIndex, "prerequisiteTrackIds"], message: `Unknown prerequisite track ${prerequisiteTrackId}` });
    const trackItemIds = new Set(track.modules.flatMap((module) => module.itemIds));
    const coveredItemIds = new Set([...trackItemIds, ...curriculum.tracks.filter((candidate) => track.prerequisiteTrackIds.includes(candidate.id)).flatMap((candidate) => candidate.modules.flatMap((module) => module.itemIds))]);
    for (const [moduleIndex, module] of track.modules.entries()) {
      if (!stageIds.has(module.stageId)) ctx.addIssue({ code: "custom", path: ["tracks", trackIndex, "modules", moduleIndex, "stageId"], message: `Unknown stage ${module.stageId}` });
      for (const itemId of module.itemIds) if (!itemById.has(itemId)) ctx.addIssue({ code: "custom", path: ["tracks", trackIndex, "modules", moduleIndex, "itemIds"], message: `Unknown item ${itemId}` });
    }
    for (const itemId of trackItemIds) {
      const item = itemById.get(itemId);
      for (const prerequisite of item?.prerequisites ?? []) if (!coveredItemIds.has(prerequisite)) ctx.addIssue({ code: "custom", path: ["tracks", trackIndex, "modules"], message: `Track ${track.id} omits prerequisite ${prerequisite} for ${itemId}` });
    }
  }
});

export type CurriculumPaper = z.infer<typeof curriculumPaperSchema>;
export type CurriculumConcept = z.infer<typeof curriculumConceptSchema>;
export type CurriculumItem = z.infer<typeof curriculumItemSchema>;
export type CurriculumModule = z.infer<typeof curriculumModuleSchema>;
export type CurriculumTrack = z.infer<typeof curriculumTrackSchema>;
export type ResearchCurriculum = z.infer<typeof researchCurriculumSchema>;
