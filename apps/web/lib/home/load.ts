import type { DiscoveryHomeResponse } from "@learnspace/shared";
import { AuthError } from "../auth/errors";
import { getHomeFeed } from "../discovery/service";
import { getLearnHome, type LearnHomeData } from "./service";
import { listStudySessions } from "../study/service";

type HomeSession = Awaited<ReturnType<typeof listStudySessions>>[number];

export type HomeData = {
  home: LearnHomeData;
  feed: DiscoveryHomeResponse;
  sessions: HomeSession[];
};

type HomeLoaders = {
  getLearnHome: typeof getLearnHome;
  getHomeFeed: typeof getHomeFeed;
  listStudySessions: typeof listStudySessions;
};

const defaultLoaders: HomeLoaders = { getLearnHome, getHomeFeed, listStudySessions };

function emptyFeed(): DiscoveryHomeResponse {
  return {
    runId: null,
    generatedAt: new Date().toISOString(),
    stale: true,
    sections: { continueLearning: [], recommendedVideos: [], researchPapers: [], freshForYou: [], interests: [] },
  };
}

function optionalResult<T>(result: PromiseSettledResult<T>, label: string, fallback: T): T {
  if (result.status === "fulfilled") return result.value;
  if (result.reason instanceof AuthError) throw result.reason;
  console.error(`[home] ${label} unavailable`, result.reason);
  return fallback;
}

export async function loadHomeData(userId: string, loaders: HomeLoaders = defaultLoaders): Promise<HomeData> {
  const [homeResult, feedResult, sessionsResult] = await Promise.allSettled([
    loaders.getLearnHome(userId),
    loaders.getHomeFeed(userId),
    loaders.listStudySessions(userId),
  ]);
  if (homeResult.status === "rejected") throw homeResult.reason;
  return {
    home: homeResult.value,
    feed: optionalResult(feedResult, "recommendations", emptyFeed()),
    sessions: optionalResult(sessionsResult, "history", []),
  };
}
