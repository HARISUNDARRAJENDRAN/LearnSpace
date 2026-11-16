import assert from "node:assert/strict";
import test from "node:test";
import data from "./data.json" with { type: "json" };
import { researchCurriculumSchema, type CurriculumPaper } from "@learnspace/shared";
import { computeResearchTrackState, getResearchTrack, listResearchTracks } from "./index.js";

const curriculum = researchCurriculumSchema.parse(data);

test("all paper metadata is present, verified, and all dependency edges form DAGs", () => {
  const itemById = new Map(curriculum.items.map((item) => [item.id, item]));
  const papers = curriculum.items.filter((item): item is CurriculumPaper => item.type === "paper");
  assert.ok(papers.length >= 100);
  for (const paper of papers) {
    assert.equal(paper.verifiedSource, "arXiv API");
    assert.ok(paper.verifiedAt);
    assert.ok(paper.title && paper.authors.length && paper.year && paper.url);
    assert.equal(paper.id, `arxiv:${paper.arxivId}`);
    assert.ok(paper.prerequisites.every((id) => itemById.has(id)), `${paper.id} has missing prerequisites`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    assert.ok(!visiting.has(id), `dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prerequisite of itemById.get(id)!.prerequisites) visit(prerequisite);
    visiting.delete(id);
    visited.add(id);
  };
  for (const item of curriculum.items) visit(item.id);
  const stageIds = new Set(curriculum.stages.map((stage) => stage.id));
  const trackIds = new Set(curriculum.tracks.map((track) => track.id));
  for (const track of curriculum.tracks) {
    assert.ok(track.nextTrackIds.every((id) => trackIds.has(id)), `${track.id} points to a missing next track`);
    for (const module of track.modules) {
      assert.ok(stageIds.has(module.stageId), `${module.id} points to a missing stage`);
      assert.ok(module.itemIds.every((id) => itemById.has(id)), `${module.id} points to a missing item`);
    }
  }
  for (const track of listResearchTracks()) {
    const dag = getResearchTrack(track.id)!;
    assert.equal(new Set(dag.topologicalItemIds).size, dag.items.length, `${track.id} contains a dependency cycle`);
    const covered = new Set([...dag.items, ...track.prerequisiteTrackIds.flatMap((id) => getResearchTrack(id)!.items)].map((item) => item.id));
    assert.ok(dag.items.every((item) => item.prerequisites.every((id) => covered.has(id))), `${track.id} omits a prerequisite`);
  }
});

test("paper openings do not unlock dependents; completion threshold does", () => {
  const track = getResearchTrack("ml-foundations")!;
  const classical = track.items.find((item) => item.type === "paper" && item.arxivId === "1603.02754")!;
  const dependent = track.items.find((item) => item.type === "paper" && item.prerequisites.includes(classical.id))!;
  const profile = { selfReportedLevel: "beginner" as const, interests: ["boosting"] };
  const opened = computeResearchTrackState(track.track.id, new Map([["1603.02754", { status: "in-progress" as const, progressPct: 89, lastOpenedAt: "2026-11-16T00:00:00Z" }]]), profile)!;
  assert.equal(opened.items.find((entry) => entry.item.id === classical.id)?.status, "in-progress");
  assert.equal(opened.items.find((entry) => entry.item.id === dependent.id)?.status, "locked-by-prereqs");
  const completed = computeResearchTrackState(track.track.id, new Map([["1603.02754", { status: "in-progress" as const, progressPct: 90, lastOpenedAt: null }]]), profile)!;
  assert.equal(completed.items.find((entry) => entry.item.id === classical.id)?.status, "done");
  assert.equal(completed.items.find((entry) => entry.item.id === dependent.id)?.status, "ready");
  assert.ok(completed.recommendedNext.length > 0);
  assert.ok(completed.recommendedNext.every((item) => completed.items.find((entry) => entry.item.id === item.id)?.status === "ready" || completed.items.find((entry) => entry.item.id === item.id)?.status === "optional"));
});

test("concepts never gate papers, and a prerequisite track's papers count once read", () => {
  const profile = { selfReportedLevel: "intermediate" as const, interests: [] };
  const foundations = computeResearchTrackState("ml-foundations", new Map(), profile)!;
  for (const entry of foundations.items) {
    const gatedByPaperOnly = entry.item.prerequisites.every((id) => foundations.items.find((other) => other.item.id === id)?.item.type === "concept");
    if (gatedByPaperOnly) assert.notEqual(entry.status, "locked-by-prereqs", `${entry.item.id} is locked behind concepts only`);
  }
  const track = getResearchTrack("transformers-llms")!;
  const external = track.items.flatMap((item) => item.prerequisites).find((id) => !track.items.some((item) => item.id === id) && id.startsWith("arxiv:"));
  assert.ok(external, "the track builds on a foundations paper");
  const dependent = track.items.find((item) => item.prerequisites.includes(external))!;
  const beginner = { selfReportedLevel: "beginner" as const, interests: [] };
  const before = computeResearchTrackState(track.track.id, new Map(), beginner)!;
  const locked = before.items.find((entry) => entry.item.id === dependent.id)!;
  assert.equal(locked.status, "locked-by-prereqs");
  assert.deepEqual(locked.waitingOn, [external]);
  const after = computeResearchTrackState(track.track.id, new Map([[external.slice("arxiv:".length), { status: "completed" as const, progressPct: 100, lastOpenedAt: null }]]), beginner)!;
  assert.notEqual(after.items.find((entry) => entry.item.id === dependent.id)?.status, "locked-by-prereqs");
  // An intermediate learner is assumed to know the foundations the track builds on.
  assert.notEqual(computeResearchTrackState(track.track.id, new Map(), profile)!.items.find((entry) => entry.item.id === dependent.id)?.status, "locked-by-prereqs");
});

test("unknown tracks return null", () => {
  assert.equal(computeResearchTrackState("unknown", new Map(), { selfReportedLevel: "beginner", interests: [] }), null);
});
