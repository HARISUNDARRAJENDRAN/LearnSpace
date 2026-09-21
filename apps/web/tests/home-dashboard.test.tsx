import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { HomeDashboard } from "../components/home/HomeDashboard";

const router = { bfcacheId: "home-test", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

test("Home keeps the hero focused and history actions without bars", () => {
  const item = {
    resourceId: "lesson", sessionId: "session", title: "Learning Python", channelTitle: "Python Academy",
    youtubeId: "_uQrJ0TkZlc", thumbnailUrl: null, thumbnailFallbackUrl: null,
    durationMs: 3_200_000, description: null, progressPct: 41, lastActiveAt: new Date().toISOString(),
  };
  const feed = { runId: null, generatedAt: item.lastActiveAt, stale: false, sections: {
    continueLearning: [], recommendedVideos: [], researchPapers: [], freshForYou: [], interests: [],
  } };
  const sessions = [{
    id: "history", title: "Learning Python", status: "active" as const, mode: "guided_learning" as const,
    lastActiveAt: item.lastActiveAt, resourceCount: 1, progressPct: 41,
    activeResource: { id: "lesson", title: "Learning Python", type: "video" as const, youtubeId: null, readiness: "ready" as const },
    route: "/app/sessions",
  }];
  const render = (durationMs: number | null) => renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <HomeDashboard home={{ continueWatching: { ...item, durationMs }, relatedAnchor: null, relatedVideos: [] }} feed={feed} sessions={sessions} />
    </AppRouterContext.Provider>,
  );
  const markup = render(item.durationMs);
  assert.doesNotMatch(markup, /min remaining|home-hero-progress-copy/);
  assert.match(markup, /class="home-progress-gauge" role="img" aria-label="41% complete"/);
  assert.doesNotMatch(markup, /<progress/);
  assert.doesNotMatch(markup, /Open session|home-session-action|\/app\/study\/video\/session/);
  assert.match(markup, />Resume<\/button>/);
  assert.match(markup, /home-history-play/);
});
