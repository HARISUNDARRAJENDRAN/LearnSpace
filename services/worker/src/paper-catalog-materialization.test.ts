import assert from "node:assert/strict";
import test from "node:test";
import type { CurriculumItem, CurriculumTrack, ResearchCurriculum } from "@learnspace/shared";
import { curriculumPaperMetadata, curriculumTrackSections } from "./paper-catalog-materialization.js";

const items: CurriculumItem[] = [
  { id: "concept", stageId: "stage", type: "concept", title: "Core idea", why: "This explains the needed background.", difficulty: "beginner", keyConcepts: ["idea"], prerequisites: [], required: true, codingApplicability: "project-guide" },
  { id: "paper-b", stageId: "stage", type: "paper", arxivId: "2301.00002", doi: null, title: "Second", authors: ["B"], year: 2023, venue: null, url: "https://arxiv.org/abs/2301.00002", verifiedAt: "2024-01-01T00:00:00Z", verifiedSource: "arXiv API", why: "This is a required work in the track.", difficulty: "beginner", keyConcepts: ["idea"], prerequisites: [], required: true, codingApplicability: "project-guide" },
  { id: "paper-a", stageId: "stage", type: "paper", arxivId: "2301.00001", doi: null, title: "First", authors: ["A"], year: 2023, venue: null, url: "https://arxiv.org/abs/2301.00001", verifiedAt: "2024-01-01T00:00:00Z", verifiedSource: "arXiv API", why: "This is an optional work in the track.", difficulty: "beginner", keyConcepts: ["idea"], prerequisites: [], required: false, codingApplicability: "project-guide" },
  { id: "paper-extra", stageId: "stage", type: "paper", arxivId: "2301.00003", doi: null, title: "Extra", authors: ["C"], year: 2023, venue: null, url: "https://arxiv.org/abs/2301.00003", verifiedAt: "2024-01-01T00:00:00Z", verifiedSource: "arXiv API", why: "This is catalogued outside the tracks.", difficulty: "beginner", keyConcepts: ["idea"], prerequisites: [], required: false, codingApplicability: "project-guide" },
];
const track: CurriculumTrack = { id: "track", title: "Track", audience: "Learners", assumedKnowledge: [], outcomes: ["Understand"], estimatedHours: 2, modules: [{ id: "module-1", title: "First module", stageId: "stage", itemIds: ["concept", "paper-b", "paper-a"] }], nextTrackIds: [], prerequisiteTrackIds: [] };
const curriculum: ResearchCurriculum = { version: 1, stages: [{ id: "stage", title: "Stage", order: 0 }], items, tracks: [track] };

test("curriculum materialization keeps module and paper order and stores concepts in section metadata", () => {
  const layout = curriculumTrackSections(track, items);
  assert.deepEqual(layout[0]?.papers, [
    { arxivId: "2301.00002", position: 0, itemId: "paper-b" },
    { arxivId: "2301.00001", position: 1, itemId: "paper-a" },
  ]);
  assert.deepEqual(layout[0]?.metadata.concepts.map(({ id }) => id), ["concept"]);
  assert.deepEqual(curriculumPaperMetadata(curriculum).get("2301.00001"), { itemIds: ["paper-a"], trackIds: ["track"] });
  assert.deepEqual(curriculumPaperMetadata(curriculum).get("2301.00003"), { itemIds: ["paper-extra"], trackIds: [] });
  assert.deepEqual(curriculumTrackSections(track, items), layout, "rerunning the materialization plan is deterministic");
});
