"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { LearnHomeData } from "../../lib/home/service";
import { PlanCalendar } from "./calendar/PlanCalendar";
import { LevelCard, NextActions, RecentStudy } from "./HomeCards";

export function HomeDashboard({ home }: { home: LearnHomeData }) {
  const router = useRouter();
  const [version, setVersion] = useState(0);
  const [observing, setObserving] = useState(true);

  const refresh = useCallback(() => {
    setVersion((value) => value + 1);
    router.refresh();
  }, [router]);

  // Each visit (and each plan change) runs one observer tick, then shows what it updated.
  const observe = useCallback(async () => {
    setObserving(true);
    try {
      const response = await fetch("/api/v1/plan/observe", { method: "POST" });
      if (response.ok && (await response.json() as { changed: boolean }).changed) refresh();
    } catch {
      // The plan still works without a tick; the next visit retries.
    } finally {
      setObserving(false);
    }
  }, [refresh]);

  useEffect(() => { void observe(); }, [observe]);

  const changed = useCallback(() => {
    refresh();
    void observe();
  }, [refresh, observe]);

  return <main className="home-page" aria-label="Home">
    <PlanCalendar version={version} onChanged={changed} />
    <div className="home-cards">
      <RecentStudy lessons={home.recentLessons} today={home.today} />
      <NextActions actions={home.nextActions} thinking={observing} onChanged={changed} />
      <LevelCard progression={home.progression} />
    </div>
  </main>;
}
