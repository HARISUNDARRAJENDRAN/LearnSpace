import assert from "node:assert/strict";
import test from "node:test";
import type { DiscoveryHomeResponse } from "@learnspace/shared";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscoverLanding } from "../components/discovery/DiscoverLanding";
import { getCurriculum } from "../lib/discovery/curriculum";
import { DiscoveryFeed } from "../components/discovery/DiscoveryFeed";

test("personal feed precedes existing curated playlists without obsolete dashboard sections", async () => {
  const html = renderToStaticMarkup(<DiscoverLanding areas={await getCurriculum()} feed={null} />);
  assert.ok(html.indexOf("Recommended for you") < html.indexOf("discover-topic-catalog"));
  assert.match(html, /Recommendations are unavailable/);
  assert.match(html, /Curated collection/);
  assert.doesNotMatch(html, /Your learning space|Explore your interests|Nothing here yet|Pick up where|AI recommended/);
  const disabled = renderToStaticMarkup(<DiscoverLanding areas={[]} recommendationsEnabled={false} />);
  assert.doesNotMatch(disabled, /Recommended for you/);
});

test("empty recommendations have no sample videos or fabricated learning activity", () => {
  const html = renderToStaticMarkup(<DiscoveryFeed feed={null} />);
  assert.doesNotMatch(html, /discovery-card-image|Start learning|Sample|affinity|confidence/);
});

test("real recommendation cards show subtle reasons and learning actions without internal weights", () => {
  const router = { bfcacheId: "feed-test", back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  const feed: DiscoveryHomeResponse = { runId: "run", generatedAt: new Date().toISOString(), stale: false, personalization: "learning", sections: { continueLearning: [], interests: [], recommendedVideos: [
    { resourceId: "video", runId: "run", position: 0, type: "video", title: "Understanding Python generators", author: "Learning Lab", url: "https://youtube.com/watch?v=abcdefghijk", thumbnailUrl: null, description: null, durationMs: 600000, publishedAt: null, reason: "Related to your recent Python sessions", reasonCodes: ["recent_learning"] },
  ] } };
  const html = renderToStaticMarkup(<AppRouterContext.Provider value={router}><DiscoveryFeed feed={feed} /></AppRouterContext.Provider>);
  assert.match(html, /Shaped by what you&#x27;ve been learning/);
  assert.match(html, /Understanding Python generators/);
  assert.match(html, /Related to your recent Python sessions/);
  assert.match(html, /Start learning/);
  assert.match(html, /Bookmark Understanding Python generators \(coming soon\)/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /Not interested|>Save</);
  assert.doesNotMatch(html, /0.87|confidence|affinity|AI recommended/);
});
