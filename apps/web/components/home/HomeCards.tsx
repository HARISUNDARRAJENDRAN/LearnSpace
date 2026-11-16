"use client";

import { ArrowUpRight, BookOpen, FileText, Flame, PenLine, Play, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatLearningDuration } from "../../lib/home/duration";
import type { HomeLesson } from "../../lib/home/service";
import { youtubeThumbnailSources } from "../../lib/home/thumbnail";
import { kindLabel } from "../../lib/plan/kinds";
import { LEVEL_XP, type Progression, RANKS, type Rank } from "../../lib/plan/levels";
import type { PlanItem } from "../../lib/plan/service";
import { StartStudyButton } from "../study/StudyActions";
import { BAR, barSlice, barStripes, dialStripes, GROWTH, ringSlice, type Stops } from "../ui/stripes";
import { addDays, dayKey, format } from "./calendar/dates";
import { useNow } from "./calendar/useNow";
import { YouTubeThumbnail } from "./YouTubeThumbnail";

function opened(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return format.short(day);
}

const kind = (type: string) => type === "video" ? "Video" : type === "paper" || type === "pdf" ? "Paper" : "Lesson";

function Card({ title, sub, action, children, className = "" }: { title: string; sub?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`home-card home-tile ${className}`} aria-label={title}>
    <header className="home-card-head"><div><h2>{title}</h2>{sub ? <p className="home-sub">{sub}</p> : null}</div>{action}</header>
    {children}
  </section>;
}

/** A straight bar of fine wavy stripes, filled to `value` (0–1) with the rest left pale. */
function StripeBar({ value, stops = GROWTH, label }: { value: number; stops?: Stops; label: string }) {
  const clip = `home-bar-${useId().replace(/:/g, "")}`;
  const stripes = useMemo(() => barStripes(stops), [stops]);
  const filled = Math.max(0, Math.min(1, value));
  // Filled and ahead are separate rounded blocks with a small gap, like the dial's bands.
  const blocks = filled <= 0.02 ? [[0, 1]] : filled >= 0.98 ? [[0, 1]] : [[0, filled - 0.006], [filled + 0.006, 1]];
  return <span className="home-stripes" role="progressbar" aria-valuenow={Math.round(filled * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
    <svg viewBox={`0 0 ${BAR.width} ${BAR.height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><clipPath id={clip}>{blocks.map(([from, to]) => <path key={from} d={barSlice(from ?? 0, to ?? 1)} />)}</clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        {stripes.map((stripe, index) => <path key={stripe.d} d={stripe.d} stroke={stripe.color} className={stripe.t > filled ? "is-ahead" : undefined} style={{ "--s": index } as React.CSSProperties} />)}
      </g>
    </svg>
  </span>;
}

export function RecentStudy({ lessons, today }: { lessons: HomeLesson[]; today: string }) {
  const [lesson, ...rest] = lessons;
  if (!lesson) return <Card title="Recent study" sub="Pick up where you left off" className="home-recent">
    <div className="home-empty"><p>Your last video or paper will appear here with how far you got.</p><Link className="home-pill-button" href="/app/discover">Find a lesson</Link></div>
  </Card>;
  const progress = Math.round(Math.max(0, Math.min(100, lesson.progressPct)));
  const done = lesson.status === "completed";
  const thumbnail = youtubeThumbnailSources(lesson.youtubeId);
  return <Card title="Recent study" sub="Pick up where you left off" className="home-recent" action={<span className="home-chip">{opened(lesson.openedDay, today)}</span>}>
    <article className="home-recent-hero">
      <div className="home-recent-media">
        {thumbnail ? <YouTubeThumbnail src={thumbnail.primary} fallbackSrc={thumbnail.fallback} alt="" fill sizes="160px" /> : <FileText aria-hidden="true" />}
        <span className="home-recent-kind">{kind(lesson.type)}</span>
      </div>
      <div className="home-recent-copy">
        <h3 title={lesson.title}>{lesson.title}</h3>
        <p>{lesson.source ?? kind(lesson.type)}</p>
      </div>
    </article>
    <div className="home-figure">
      <strong>{progress}<small>%</small></strong>
      <span className={`home-badge${done ? "" : " is-quiet"}`}>{done ? "Completed" : "complete"}</span>
    </div>
    <StripeBar value={progress / 100} label="Lesson progress" />
    <dl className="home-legend">
      {lesson.durationMs ? <div><dt><i className="is-lime" />Watched</dt><dd>{formatLearningDuration(lesson.durationMs * progress / 100_000)} <span>of {formatLearningDuration(lesson.durationMs / 1000)}</span></dd></div> : null}
      <div><dt><i className="is-green" />Last session</dt><dd>{formatLearningDuration(lesson.lastSessionSeconds)}</dd></div>
      <div><dt><i className="is-pale" />Total time</dt><dd>{formatLearningDuration(lesson.spentSeconds)}</dd></div>
    </dl>
    <StartStudyButton className="home-pill-button home-recent-resume" resourceId={lesson.resourceId} origin="home" label={done ? "Review" : "Resume"} />
    {rest.length > 0 ? <ul className="home-recent-list" aria-label="Also studied">{rest.slice(0, 2).map((item) => <li key={item.resourceId}>
      <span title={item.title}>{item.title}</span><small className={item.status === "completed" ? "is-done" : undefined}>{item.status === "completed" ? "Done" : `${Math.round(item.progressPct)}%`}</small>
    </li>)}</ul> : null}
  </Card>;
}

const KIND_ICON = { watch: Play, read: BookOpen, practice: PenLine, review: RotateCcw } as const;

function dayLabel(item: PlanItem, now: Date | null): string {
  if (!now) return "Coming up";
  const day = dayKey(new Date(item.startsAt));
  return day <= dayKey(now) ? "Today" : day === addDays(dayKey(now), 1) ? "Tomorrow" : "Later this week";
}

function when(item: PlanItem, now: Date | null): string {
  if (!now) return "";
  const start = new Date(item.startsAt);
  const day = dayKey(start);
  const label = day === dayKey(now) ? "" : day === addDays(dayKey(now), 1) ? "" : `${format.weekday(day)} · `;
  const minutes = item.endsAt ? Math.round((new Date(item.endsAt).getTime() - start.getTime()) / 60_000) : null;
  return `${label}${format.time(start)}${minutes ? ` · ${minutes} min` : ""}`;
}

export function NextActions({ actions, thinking, onChanged }: { actions: PlanItem[]; thinking: boolean; onChanged: () => void }) {
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Planner items are already on the calendar; removing one tells the planner not to suggest it again.
  async function decide(item: PlanItem, status: "dismissed") {
    setBusy(item.id);
    setFailed(false);
    const response = await fetch(`/api/v1/plan/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }).catch(() => null);
    setBusy(null);
    if (!response?.ok) return setFailed(true);
    onChanged();
  }
  const groups = actions.reduce<{ label: string; items: { item: PlanItem; index: number }[] }[]>((list, item, index) => {
    const label = dayLabel(item, now);
    const last = list.at(-1);
    if (last?.label === label) last.items.push({ item, index });
    else list.push({ label, items: [{ item, index }] });
    return list;
  }, []);
  return <Card title="Next actions" sub="Planned from what you studied" className="home-next" action={<Link className="home-chip is-link" href="/app#calendar">Calendar <ArrowUpRight aria-hidden="true" /></Link>}>
    {actions.length === 0
      ? <div className="home-empty"><p>{thinking ? "Finding what to study next…" : "Study a lesson to see what to learn next."}</p></div>
      : groups.map((group) => <section key={group.label} className="home-next-group" aria-label={group.label}>
        <h3 className="home-group-label">{group.label}</h3>
        <ol className="home-next-list">{group.items.map(({ item, index }) => {
          const Icon = KIND_ICON[item.kind];
          const progress = Math.round(Math.max(0, Math.min(100, item.progressPct)));
          return <li key={item.id} className={`home-next-item kind-${item.kind}`} style={{ animationDelay: `${index * 60}ms` }}>
            <span className="home-next-kind" aria-hidden="true"><Icon /></span>
            <div className="home-next-copy">
              <div className="home-next-title"><h3>{item.title}</h3><small>{when(item, now)}</small></div>
              <StripeBar value={progress / 100} label={`${item.title} progress`} />
              <p title={item.description ?? undefined}>{progress > 0 ? <b>{progress}% done · </b> : null}{item.description ?? kindLabel[item.kind]}</p>
            </div>
            <div className="home-next-actions">
              {item.resource ? <StartStudyButton className="home-pill-button is-small" resourceId={item.resource.id} origin="home" label="Start" /> : null}
              <button type="button" className="home-round" onClick={() => void decide(item, "dismissed")} disabled={busy === item.id} aria-label={`Remove ${item.title} from your calendar`} title="Remove from calendar"><X aria-hidden="true" /></button>
            </div>
          </li>;
        })}</ol>
      </section>)}
    {failed ? <p className="plan-dialog-error" role="alert">That did not save. Try again.</p> : null}
    {actions.length > 0 ? <p className="home-card-foot">These are on your calendar and complete as you study them.</p> : null}
  </Card>;
}

export function Medal({ rank, size = 56, dim = false }: { rank: Rank; size?: number; dim?: boolean }) {
  return <svg className={`home-medal is-${rank.toLowerCase()}${dim ? " is-dim" : ""}`} width={size} height={size} viewBox="0 0 56 56" aria-hidden="true">
    <path className="home-medal-ribbon" d="M18 4h8l-4 14h-8zM30 4h8l2 14h-8z" />
    <path className="home-medal-face" d="M28 14l14.7 8.5v17L28 48l-14.7-8.5v-17z" />
    <path className="home-medal-shine" d="M28 20l9.5 5.5v11L28 42l-9.5-5.5v-11z" />
  </svg>;
}

// Ticks a number up to its new value when it changes, so XP the observer awards visibly counts in.
function useCountUp(value: number) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    const start = current.current;
    if (start === value || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = value;
      setShown(value);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - began) / 700);
      current.current = Math.round(start + (value - start) * (1 - (1 - progress) ** 3));
      setShown(current.current);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}

const LEVEL_STRIPES = dialStripes(GROWTH);

/** The level dial: a half ring of green stripes filled as far as this level's XP reaches. */
function LevelDial({ share, children }: { share: number; children: React.ReactNode }) {
  const clip = `home-dial-${useId().replace(/:/g, "")}`;
  const gap = 0.012;
  const bands = share <= 0.02 || share >= 0.98 ? [[0, 1]] : [[0, share - gap], [share + gap, 1]];
  return <div className="home-dial">
    <svg viewBox="20 18 300 154" aria-hidden="true">
      <defs><clipPath id={clip}>{bands.map(([from, to]) => <path key={from} d={ringSlice(from ?? 0, to ?? 1)} />)}</clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        {LEVEL_STRIPES.map((stripe, index) => <path key={stripe.d} d={stripe.d} stroke={stripe.color} className={stripe.t > share + 0.004 ? "is-ahead" : undefined} style={{ "--s": index } as React.CSSProperties} />)}
      </g>
    </svg>
    <div className="home-dial-center">{children}</div>
  </div>;
}

export function LevelCard({ progression }: { progression: Progression }) {
  const { xp, level, rank, levelXp, nextLevelXp, weekXp, todayXp, streak, earned } = progression;
  const shownXp = useCountUp(xp);
  const shownToday = useCountUp(todayXp);
  const span = nextLevelXp === null ? 1 : nextLevelXp - levelXp;
  const into = nextLevelXp === null ? 1 : xp - levelXp;
  const share = Math.max(0, Math.min(1, into / span));
  const percent = Math.round(share * 100);
  const fromPlan = earned.plan_watch + earned.plan_read + earned.plan_practice + earned.plan_review + earned.on_time + earned.in_slot + earned.day_plan;
  return <Card title="Level & rank" sub={`${rank} · Level ${level}`} className={`home-level is-${rank.toLowerCase()}`} action={<span className={`home-streak${streak > 0 ? " is-live" : ""}`} title="Days in a row with study"><Flame aria-hidden="true" />{streak}-day streak</span>}>
    <div className="home-figure">
      <strong>{shownXp.toLocaleString("en")}<small> XP</small></strong>
      <span className={`home-badge${todayXp > 0 ? "" : " is-quiet"}`}>{todayXp > 0 ? `▲ +${shownToday} today` : "No XP yet today"}</span>
    </div>
    <LevelDial share={share}>
      <Medal rank={rank} size={34} />
      <strong>{percent}%</strong>
      <span>{nextLevelXp === null ? "Max level reached" : `${(nextLevelXp - xp).toLocaleString("en")} XP to Level ${level + 1}`}</span>
    </LevelDial>
    <ol className="home-ranks" aria-label="Ranks">{RANKS.map((name, index) => <li key={name} aria-current={name === rank ? "step" : undefined} title={`${name}: levels ${index * 5 + 1}–${index * 5 + 5}, from ${LEVEL_XP[index * 5]?.toLocaleString("en")} XP`}>
      <Medal rank={name} size={22} dim={RANKS.indexOf(rank) < index} /><span>{name}</span>
    </li>)}</ol>
    <dl className="home-legend is-row">
      <div><dt><i className="is-lime" />Today</dt><dd>+{shownToday}</dd></div>
      <div><dt><i className="is-green" />7 days</dt><dd>+{weekXp}</dd></div>
      <div><dt><i className="is-pale" />From plan</dt><dd>{fromPlan}</dd></div>
    </dl>
    <Link className="home-card-foot home-xp-link" href="/app/profile#xp">How every activity earns XP <ArrowUpRight aria-hidden="true" /></Link>
  </Card>;
}
