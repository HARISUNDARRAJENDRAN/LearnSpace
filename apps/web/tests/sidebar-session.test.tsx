import assert from "node:assert/strict";
import test from "node:test";
import type { StudySessionSummary } from "@learnspace/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionPartLinks, sessionMatchesMode } from "../components/application/SidebarSessions";

function session(type: "video" | "paper"): StudySessionSummary {
  return {
    id: "session",
    title: "Python lesson",
    status: "active",
    mode: "guided_learning",
    lastActiveAt: "2026-11-16T00:00:00.000Z",
    endedAt: null,
    resourceCount: 1,
    progressPct: 0,
    activeResource: { id: "resource", title: "Python lesson", type, youtubeId: type === "video" ? "youtube" : null, readiness: "ready" },
    route: "/app/study/video/session",
    isCourse: false,
    hasCode: false,
  };
}

function render(codingEligible: boolean) {
  const summary = session("video");
  return renderToStaticMarkup(<SessionPartLinks session={summary} href={summary.route ?? "/app/sessions"} active={false} activeSlug="canvas" open codingEligible={codingEligible} onPartClick={() => {}} />);
}

test("nested video sessions show Code Exercises only when the resource capability allows it", () => {
  assert.doesNotMatch(render(false), /Code Exercises/);
  assert.match(render(true), /Code Exercises/);
  assert.match(render(false), /AI Notes/);
  assert.match(render(false), /Practice &amp; Quizzes/);
});

test("sidebar mode filters sessions by the active resource type", () => {
  const video = session("video");
  const paper = session("paper");
  assert.equal(sessionMatchesMode(video, "learn"), true);
  assert.equal(sessionMatchesMode(video, "research"), false);
  assert.equal(sessionMatchesMode(paper, "learn"), false);
  assert.equal(sessionMatchesMode(paper, "research"), true);
});
