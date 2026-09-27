import { getLearnHome, type LearnHomeData } from "./service";

export type HomeData = { home: LearnHomeData };

export async function loadHomeData(userId: string, getHome: typeof getLearnHome = getLearnHome): Promise<HomeData> {
  return { home: await getHome(userId) };
}
