import type { HomeData } from "../../lib/home/load";
import { createHomeAnalytics } from "../../lib/home/analytics";
import { HomeAnalyticsGrid } from "./HomeAnalyticsGrid";

export function HomeDashboard({ home }: HomeData) {
  return <HomeAnalyticsGrid data={createHomeAnalytics(home)} />;
}
