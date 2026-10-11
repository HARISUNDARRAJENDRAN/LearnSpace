"use client";

import { ArrowUpRight, BookOpen, Clock3, Flame, GraduationCap, Star } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { formatLearningDuration } from "../../lib/home/duration";
import type { HomeSessionCounts } from "../../lib/home/service";
import type { HomeUser } from "./HomeDashboard";

export function HomeProgress({ counts, seconds, completedLessons, streak, user }: { counts: HomeSessionCounts; seconds: number; completedLessons: number; streak: number; user: HomeUser }) {
  const [period, setPeriod] = useState("Overall");
  const pattern = useId();
  const total = period === "Learn" ? counts.videos : period === "Research" ? counts.papers : counts.total;
  const completed = period === "Learn" ? counts.videosCompleted : period === "Research" ? counts.papersCompleted : counts.completed;
  const percent = total > 0 ? Math.round(completed / total * 100) : 0;
  const name = user.displayName || "Your space";
  const initials = name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  const stats = [
    { label: "Learning Sessions", value: counts.total, Icon: BookOpen },
    { label: "Lessons Completed", value: completedLessons, Icon: GraduationCap },
    { label: "Total Learning Time", value: seconds > 0 ? formatLearningDuration(seconds) : "0.0h", Icon: Clock3 },
    { label: "Day Streak", value: streak, Icon: Flame },
  ];
  return <section className="home-progress-panel" aria-labelledby="home-progress-title">
    <header className="home-progress-header"><h2 id="home-progress-title">Learning Progress</h2><select className="home-period-select" aria-label="Progress scope" value={period} onChange={(event) => setPeriod(event.target.value)}>{["Overall", "Learn", "Research"].map((value) => <option key={value}>{value}</option>)}</select></header>
    <div className="home-progress-ring" role="progressbar" aria-label={`${period} sessions completed`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <svg viewBox="0 0 240 240" aria-hidden="true"><defs><pattern id={pattern} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="4" height="4" fill="#e6ece4" /><path d="M0 0V4" stroke="#cdd9cf" strokeWidth="1" /></pattern></defs><circle cx="120" cy="120" r="96" fill="none" stroke={`url(#${pattern})`} strokeWidth="22" /><circle className="home-progress-arc" cx="120" cy="120" r="96" fill="none" strokeWidth="22" pathLength="100" strokeDasharray={`${percent} 100`} transform="rotate(-90 120 120)" /></svg>
      <div className="home-progress-value"><strong>{percent}<small>%</small></strong><span>Completed</span></div>
    </div>
    <div className="home-quick-stats"><h3>Quick Stats</h3><div className="home-stats-grid">
      {stats.map(({ label, value, Icon }) => <Link href="/app/sessions" className="home-stat-card" key={label}><div className="home-stat-heading"><span>{label}</span><ArrowUpRight aria-hidden="true" /></div><div className="home-stat-value"><strong>{value}</strong><i><Icon aria-hidden="true" /></i></div></Link>)}
      <Link className="home-stat-card home-profile-card" href="/app/settings"><span className="home-profile-avatar">{initials}</span><strong>{name}</strong><span>{user.email}</span></Link>
      <Link className="home-stat-card home-achievement-card" href={completedLessons > 0 ? "/app/sessions" : "/app/discover"}><div className="home-stat-heading"><span>Achievements</span><ArrowUpRight aria-hidden="true" /></div><div><Star aria-hidden="true" /><p><strong>{completedLessons > 0 ? `${completedLessons} ${completedLessons === 1 ? "lesson" : "lessons"} completed` : "Your first lesson awaits"}</strong><span>{completedLessons > 0 ? "Keep your learning going." : "Explore Discover to get started."}</span></p></div></Link>
    </div></div>
  </section>;
}
