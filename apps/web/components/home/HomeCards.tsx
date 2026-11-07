"use client";

import { ArrowUpRight, CalendarPlus, FileText, Flame, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatLearningDuration } from "../../lib/home/duration";
import type { HomeLesson } from "../../lib/home/service";
import { youtubeThumbnailSources } from "../../lib/home/thumbnail";
import { LEVEL_XP, RANKS, type Progression, type Rank } from "../../lib/plan/levels";
import type { PlanItem } from "../../lib/plan/service";
import { StartStudyButton } from "../study/StudyActions";
import { addDays, dayKey, format } from "./calendar/dates";
import { useNow } from "./calendar/useNow";
import { YouTubeThumbnail } from "./YouTubeThumbnail";

function opened(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return format.short(day);
}

const kind = (type: string) => type === "video" ? "Video" : type === "paper" || type === "pdf" ? "Paper" : "Lesson";

function Card({ title, action, children, className = "" }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`home-card ${className}`} aria-label={title}>
    <header className="home-card-head"><h2>{title}</h2>{action}</header>
    {children}
  </section>;
}

export function RecentStudy({ lessons, today }: { lessons: HomeLesson[]; today: string }) {
  const [lesson, ...rest] = lessons;
  if (!lesson) return <Card title="Recent study" className="home-recent">
    <div className="home-empty"><p>Your last video or paper will appear here with how far you got.</p><Link className="plan-button is-primary" href="/app/discover">Find a lesson</Link></div>
  </Card>;
  const progress = Math.round(Math.max(0, Math.min(100, lesson.progressPct)));
  const thumbnail = youtubeThumbnailSources(lesson.youtubeId);
  return <Card title="Recent study" className="home-recent" action={<Link className="home-card-link" href="/app/sessions">View all <ArrowUpRight aria-hidden="true" /></Link>}>
    <article className="home-recent-hero">
      <div className="home-recent-media">
        {thumbnail ? <YouTubeThumbnail src={thumbnail.primary} fallbackSrc={thumbnail.fallback} alt="" fill sizes="160px" /> : <FileText aria-hidden="true" />}
        <span className="home-recent-kind">{kind(lesson.type)}</span>
      </div>
      <div className="home-recent-copy">
        <h3 title={lesson.title}>{lesson.title}</h3>
        <p>{lesson.source ?? kind(lesson.type)} · {opened(lesson.openedDay, today)}</p>
      </div>
    </article>
    <div className="home-recent-progress">
      <div><span>{lesson.status === "completed" ? "Completed" : `${progress}% complete`}</span><span>{lesson.durationMs ? `${formatLearningDuration(lesson.durationMs * progress / 100_000)} of ${formatLearningDuration(lesson.durationMs / 1000)}` : ""}</span></div>
      <span className="home-meter" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Lesson progress"><i style={{ width: `${progress}%` }} /></span>
    </div>
    <dl className="home-recent-stats">
      <div><dt>Last session</dt><dd>{formatLearningDuration(lesson.lastSessionSeconds)}</dd></div>
      <div><dt>Total time</dt><dd>{formatLearningDuration(lesson.spentSeconds)}</dd></div>
    </dl>
    <StartStudyButton className="plan-button is-primary home-recent-resume" resourceId={lesson.resourceId} origin="home" label={lesson.status === "completed" ? "Review" : "Resume"} />
    {rest.length > 0 ? <ul className="home-recent-list">{rest.slice(0, 2).map((item) => <li key={item.resourceId}>
      <span title={item.title}>{item.title}</span><small>{item.status === "completed" ? "Done" : `${Math.round(item.progressPct)}%`}</small>
    </li>)}</ul> : null}
  </Card>;
}

function when(item: PlanItem, now: Date | null): string {
  if (!now) return "";
  const start = new Date(item.startsAt);
  const day = dayKey(start);
  const label = day === dayKey(now) ? "Today" : day === addDays(dayKey(now), 1) ? "Tomorrow" : format.weekday(day);
  const minutes = item.endsAt ? Math.round((new Date(item.endsAt).getTime() - start.getTime()) / 60_000) : null;
  return `${label} · ${format.time(start)}${minutes ? ` · ${minutes} min` : ""}`;
}

export function NextActions({ actions, thinking, onChanged }: { actions: PlanItem[]; thinking: boolean; onChanged: () => void }) {
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  async function decide(item: PlanItem, status: "planned" | "dismissed") {
    setBusy(item.id);
    setFailed(false);
    const response = await fetch(`/api/v1/plan/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }).catch(() => null);
    setBusy(null);
    if (!response?.ok) return setFailed(true);
    onChanged();
  }
  return <Card title="Next actions" className="home-next">
    {actions.length === 0
      ? <div className="home-empty"><p>{thinking ? "Finding what to study next…" : "Study a lesson to see what to learn next."}</p></div>
      : <ol className="home-next-list">{actions.map((item, index) => <li key={item.id} className="home-next-item" style={{ animationDelay: `${index * 60}ms` }}>
        <span className="home-next-index" aria-hidden="true">{index + 1}</span>
        <div className="home-next-copy">
          <h3>{item.title}</h3>
          {item.description ? <p title={item.description}>{item.description}</p> : null}
          <small>{when(item, now)}{item.resource ? ` · ${kind(item.resource.type)}` : ""}</small>
          <div className="home-next-actions">
            <button type="button" className="plan-button is-primary" onClick={() => void decide(item, "planned")} disabled={busy === item.id}><CalendarPlus aria-hidden="true" />Add to plan</button>
            {item.resource ? <StartStudyButton className="plan-button" resourceId={item.resource.id} origin="home" label="Start" /> : null}
            <button type="button" className="plan-icon-button" onClick={() => void decide(item, "dismissed")} disabled={busy === item.id} aria-label={`Dismiss ${item.title}`}><X aria-hidden="true" /></button>
          </div>
        </div>
      </li>)}</ol>}
    {failed ? <p className="plan-dialog-error" role="alert">That did not save. Try again.</p> : null}
    {actions.length > 0 ? <p className="home-card-foot">Added items join your calendar and complete as you study.</p> : null}
  </Card>;
}

export function Medal({ rank, size = 56, dim = false }: { rank: Rank; size?: number; dim?: boolean }) {
  return <svg className={`home-medal is-${rank.toLowerCase()}${dim ? " is-dim" : ""}`} width={size} height={size} viewBox="0 0 56 56" aria-hidden="true">
    <path className="home-medal-ribbon" d="M18 4h8l-4 14h-8zM30 4h8l2 14h-8z" />
    <path className="home-medal-face" d="M28 14l14.7 8.5v17L28 48l-14.7-8.5v-17z" />
    <path className="home-medal-shine" d="M28 20l9.5 5.5v11L28 42l-9.5-5.5v-11z" />
  </svg>;
}

export function LevelCard({ progression }: { progression: Progression }) {
  const { xp, level, rank, levelXp, nextLevelXp, weekXp, todayXp, streak, earned } = progression;
  const span = nextLevelXp === null ? 1 : nextLevelXp - levelXp;
  const into = nextLevelXp === null ? 1 : xp - levelXp;
  const percent = Math.round(into / span * 100);
  return <Card title="Level & rank" className="home-level" action={<span className="home-streak" title="Days in a row with study"><Flame aria-hidden="true" />{streak}-day streak</span>}>
    <div className="home-level-hero">
      <Medal rank={rank} size={72} />
      <div>
        <p className="home-level-rank">{rank}</p>
        <h3>Level {level}</h3>
        <p className="home-level-xp"><b>{xp.toLocaleString("en")}</b> XP total</p>
      </div>
    </div>
    <div className="home-level-progress">
      <div><span>{nextLevelXp === null ? "Max level reached" : `${(nextLevelXp - xp).toLocaleString("en")} XP to Level ${level + 1}`}</span><span>{percent}%</span></div>
      <span className="home-meter is-xp" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next level"><i style={{ width: `${percent}%` }} /></span>
    </div>
    <ol className="home-ranks" aria-label="Ranks">{RANKS.map((name, index) => <li key={name} aria-current={name === rank ? "step" : undefined} title={`${name}: levels ${index * 5 + 1}–${index * 5 + 5}, from ${LEVEL_XP[index * 5]!.toLocaleString("en")} XP`}>
      <Medal rank={name} size={26} dim={RANKS.indexOf(rank) < index} /><span>{name}</span>
    </li>)}</ol>
    <dl className="home-level-stats">
      <div><dt>Today</dt><dd>+{todayXp}</dd></div>
      <div><dt>Last 7 days</dt><dd>+{weekXp}</dd></div>
      <div><dt>From plan</dt><dd>{earned.plan_watch + earned.plan_read + earned.plan_practice + earned.plan_review}</dd></div>
    </dl>
    <Link className="home-card-foot home-xp-link" href="/app/profile#xp">How every activity earns XP <ArrowUpRight aria-hidden="true" /></Link>
  </Card>;
}
