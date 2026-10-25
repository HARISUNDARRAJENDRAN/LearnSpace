"use client";

import { ArrowUpRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import { animate, motion, useReducedMotion } from "framer-motion";
import { type ReactNode, useId, useLayoutEffect, useState } from "react";
import { createHomePulse, type HomeBucket, type HomePulse, type HomeRhythmPeriod, type HomeStats } from "../../lib/home/analytics";
import { formatLearningDuration } from "../../lib/home/duration";
import type { HomeLesson, LearnHomeData } from "../../lib/home/service";
import { StartStudyButton } from "../study/StudyActions";
import { WaveArc, WaveBar } from "./WaveTexture";

const formatTones = ["#a6e83d", "#d8e23b", "#f2c94c", "#f58b4b"];
const periods: { id: HomeRhythmPeriod; label: string }[] = [{ id: "week", label: "This week" }, { id: "month", label: "This month" }, { id: "all", label: "All time" }];
const shownLessons = 3;
type LessonFilter = "in_progress" | "completed";
type Tone = "lime" | "orange" | "grey";

// Every date here is already a calendar day in the learner's timezone, so UTC formatting keeps it intact.
function date(day: string | null): string {
  if (!day) return "—";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).formatToParts(new Date(`${day}T00:00:00Z`)).map((part) => [part.type, part.value]));
  return `${parts.day} ${parts.month}, ${parts.year}`;
}

function weekday(day: string): string {
  return new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

function opened(day: string, today: string): string {
  const ago = Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000);
  if (ago <= 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (ago < 7) return weekday(day);
  return day.slice(0, 4) === today.slice(0, 4) ? date(day).replace(/, \d+$/, "") : date(day);
}

function label(value: string): string {
  const text = value === "pdf" ? "paper" : value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const easeOut = [.22, 1, .36, 1] as const;

// Numbers count up from zero when they appear, so the page feels alive.
function Count({ value, show }: { value: number; show: (value: number) => ReactNode }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  useLayoutEffect(() => {
    if (reduce) return;
    const controls = animate(0, value, { duration: .9, ease: easeOut, onUpdate: setShown });
    return () => controls.stop();
  }, [value, reduce]);
  return show(reduce ? value : Math.round(shown));
}

// Big digits with small unit letters, like the design's currency prefixes.
function Duration({ seconds }: { seconds: number }) {
  return formatLearningDuration(seconds).split(/(\d+)/).filter(Boolean).map((part) => /\d/.test(part) ? part : <small key={part}>{part}</small>);
}

function Overview({ lesson }: { lesson: HomeLesson | undefined }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const progress = lesson ? Math.max(0, Math.min(100, Math.round(lesson.progressPct))) : 0;
  return <section className="home-card home-overview" aria-label="Lesson overview">
    <div>
    <h3 title={lesson?.title}>{lesson?.title ?? "Overview"}</h3>
    <p>{lesson ? `${lesson.source ?? label(lesson.type)} · ${progress}% explored` : "Open a lesson to see your progress."}</p>
    <svg className="home-overview-bar" viewBox="0 0 300 16" preserveAspectRatio="none" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Lesson progress">
      <defs><linearGradient id={id} x1="0" x2="300" gradientUnits="userSpaceOnUse"><stop stopColor="#e5484d" /><stop offset=".45" stopColor="#f5a524" /><stop offset=".7" stopColor="#d8e23b" /><stop offset="1" stopColor="#8bdc2f" /></linearGradient></defs>
      <WaveBar width={300} height={16} paint="#dfe1e1" />
      {progress > 0 && <g className="home-overview-fill"><WaveBar width={Math.max(16, progress * 3)} height={16} paint={`url(#${id})`} /></g>}
    </svg>
    <div className="home-overview-figures">
      <div><span>Time spent</span><strong>{lesson ? <Duration seconds={lesson.spentSeconds} /> : "—"}</strong></div>
      {lesson?.durationMs ? <div><span>Length</span><strong><Duration seconds={lesson.durationMs / 1000} /></strong></div> : null}
    </div>
    </div>
    <div className="home-overview-side">
    {lesson ? <>
      <dl className="home-overview-facts">
        <div><dt>Type</dt><dd>{label(lesson.type)}</dd></div>
        <div><dt>Started</dt><dd>{date(lesson.startedDay)}</dd></div>
        <div><dt>Last opened</dt><dd>{date(lesson.openedDay)}</dd></div>
      </dl>
      <StartStudyButton className="home-black-button is-quiet" resourceId={lesson.resourceId} origin="home" label={lesson.status === "completed" ? "Review lesson" : "Resume lesson"} />
    </> : <Link className="home-black-button is-quiet" href="/app/discover">Find a lesson</Link>}
    </div>
  </section>;
}

function StudyMix({ formats, total }: { formats: HomePulse["formats"]; total: number }) {
  let angle = 0;
  const top = formats.toSorted((left, right) => right.seconds - left.seconds)[0];
  return <section className="home-card home-mix" aria-label="Study mix">
    <h3>Study mix</h3>
    <p>How your study time splits across formats.</p>
    <div className="home-mix-body">
      <div className="home-donut">
        <svg viewBox="0 0 160 160" aria-hidden="true">
          <WaveArc cx={80} cy={80} inner={52} outer={72} from={0} to={360} paint="#d9dcdc" />
          {formats.map((item, index) => {
            const from = angle + 14;
            const to = angle + item.percent * 3.6 - 14;
            angle += item.percent * 3.6;
            return to > from ? <WaveArc key={item.label} cx={80} cy={80} inner={52} outer={72} from={from} to={to} paint={formatTones[index] ?? "#a6e83d"} /> : null;
          })}
        </svg>
        <div className="home-donut-center">{top ? <><strong>{Math.round(top.percent)}%</strong><span><b>{formatLearningDuration(top.seconds)}</b> out of</span><span>{formatLearningDuration(total)}</span></> : <span>No study yet</span>}</div>
      </div>
      <div className="home-mix-legend">
        <ul>{formats.map((item, index) => <li key={item.label}><svg viewBox="0 0 64 10" aria-hidden="true"><WaveBar width={64} height={10} paint={formatTones[index] ?? "#a6e83d"} /></svg>{item.label} {Math.round(item.percent)}%</li>)}</ul>
      </div>
    </div>
  </section>;
}

function Lessons({ lessons, today, empty }: { lessons: HomeLesson[]; today: string; empty: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const detailId = useId();
  const selected = lessons.find((lesson) => lesson.resourceId === openId) ?? lessons[0];
  return <section className="home-lessons" aria-label="Recent lessons">
    <div className="home-lesson-row home-lesson-head" aria-hidden="true"><span>Opened</span><span>Recent lessons</span><span>Time</span><span>Progress</span><span /></div>
    {lessons.length === 0
      ? <div className="home-lesson-row home-lesson-empty"><span>{empty}</span><Link href="/app/discover">Discover</Link></div>
      : lessons.map((lesson) => <button key={lesson.resourceId} type="button" className="home-lesson-row" aria-pressed={lesson === selected} aria-controls={detailId} onClick={() => setOpenId(lesson.resourceId)}>
        <span>{opened(lesson.openedDay, today)}</span>
        <span className="home-lesson-title"><b title={lesson.title}>{lesson.title}</b><small>{lesson.source ?? label(lesson.type)}</small></span>
        <span>{formatLearningDuration(lesson.spentSeconds)}</span>
        <span>{lesson.status === "completed" ? "Completed" : `${Math.round(lesson.progressPct)}%`}</span>
        <span className="home-lesson-toggle"><ChevronDown aria-hidden="true" /></span>
      </button>)}
    <div id={detailId}><Overview key={selected?.resourceId ?? "empty"} lesson={selected} /></div>
  </section>;
}

function Week({ series, today }: { series: HomeBucket[]; today: string }) {
  const best = series.reduce((top, bucket) => bucket.stats.studySeconds > top.stats.studySeconds ? bucket : top);
  const most = Math.max(best.stats.studySeconds, 1);
  return <section className="home-card home-week" aria-label="This week">
    <h3>This week</h3>
    <p>{best.stats.studySeconds > 0 ? `Your best day was ${weekday(best.start)} with ${formatLearningDuration(best.stats.studySeconds)}.` : "Your study days will fill in here."}</p>
    <ol>{series.map(({ start, stats }, index) => <li key={start} className={start === today ? "is-today" : start > today ? "is-future" : ""}>
      <span className="home-week-value" aria-hidden="true">{start === best.start && stats.studySeconds > 0 ? formatLearningDuration(stats.studySeconds) : ""}</span>
      <span className="home-week-track">{stats.studySeconds > 0 && <span className="home-week-fill" style={{ height: `${Math.max(8, stats.studySeconds / most * 100)}%`, animationDelay: `${120 + index * 45}ms` }} />}</span>
      <span className="home-week-day" aria-hidden="true">{weekday(start).charAt(0)}</span>
      <span className="sr-only">{`${weekday(start)}${start === today ? " (today)" : ""}: ${formatLearningDuration(stats.studySeconds)}`}</span>
    </li>)}</ol>
  </section>;
}

function band(score: number): string {
  return score >= 85 ? "Consistent" : score >= 60 ? "Steady" : "Building";
}

function Gauge({ score, previous, caption }: { score: number; previous: number | null; caption: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const reduce = useReducedMotion();
  const angle = (fraction: number) => -118 + fraction * 236;
  const point = (degrees: number) => `${170 + 123 * Math.sin(degrees * Math.PI / 180)} ${150 - 123 * Math.cos(degrees * Math.PI / 180)}`;
  // One arc per band (Building < 60 ≤ Steady < 85 ≤ Consistent). Each gap is centred on its
  // threshold and must outgrow the two round caps (about .075 each) to stay visible.
  const segments = [[0, .545], [.655, .795], [.905, 1]] as const;
  const value = score / 100;
  const change = previous === null ? null : score - previous;
  return <div className="home-gauge">
    <svg viewBox="0 -14 340 264" aria-hidden="true">
      <defs><linearGradient id={id} x1="40" x2="300" gradientUnits="userSpaceOnUse"><stop stopColor="#e5484d" /><stop offset=".35" stopColor="#f2763c" /><stop offset=".6" stopColor="#f2c230" /><stop offset=".8" stopColor="#b5e03a" /><stop offset="1" stopColor="#8bdc2f" /></linearGradient></defs>
      {/* The fill sweeps in under a mask that runs past both ends so the round caps survive. */}
      <mask id={`${id}-sweep`}><motion.path d={`M${point(-140)} A123 123 0 1 1 ${point(140)}`} fill="none" stroke="#fff" strokeWidth={70} initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: Math.min(1, (angle(value) + 154) / 280) }} transition={{ duration: 1, ease: easeOut }} /></mask>
      {segments.map(([from, to]) => <WaveArc key={from} cx={170} cy={150} inner={104} outer={142} from={angle(from)} to={angle(to)} paint="#dcdede" />)}
      <g mask={`url(#${id}-sweep)`}>{segments.map(([from, to]) => value > from && <WaveArc key={from} cx={170} cy={150} inner={104} outer={142} from={angle(from)} to={angle(Math.min(value, to))} paint={`url(#${id})`} />)}</g>
      {[0, 60, 85, 100].map((tick) => {
        const radians = angle(tick / 100) * Math.PI / 180;
        const radius = tick === 0 || tick === 100 ? 172 : 164;
        return <text key={tick} x={170 + radius * Math.sin(radians)} y={150 - radius * Math.cos(radians) + 4} textAnchor="middle">{tick}</text>;
      })}
    </svg>
    <div className="home-gauge-center">
      {change ? <span className={`home-gauge-change${change < 0 ? " is-down" : ""}`}><span aria-hidden="true">{change < 0 ? "▼" : "▲"}</span> {Math.abs(change)} pts</span> : null}
      <strong><Count value={score} show={String} /></strong>
      <span className="home-gauge-caption">{caption}</span>
    </div>
  </div>;
}

// Orange is reserved for drops that matter (alarm); other drops stay neutral.
function trend(current: number, previous: number, alarm: boolean): { text: string; tone: Tone } {
  const drop: Tone = alarm ? "orange" : "grey";
  if (current === 0 && previous === 0) return { text: "Not yet", tone: drop };
  if (previous === 0) return { text: "New", tone: "lime" };
  const change = Math.round((current - previous) / previous * 100);
  if (change === 0) return { text: "Steady", tone: "lime" };
  return change > 0 ? { text: `+${change}%`, tone: "lime" } : { text: `−${-change}%`, tone: drop };
}

function Spark({ values }: { values: { key: string; value: number }[] }) {
  const most = Math.max(0, ...values.map(({ value }) => value));
  return <span className="home-spark" aria-hidden="true">{values.map(({ key, value }, index) => <i key={key} className={value > 0 ? "is-on" : ""} style={{ height: value > 0 ? `${Math.max(12, value / most * 100)}%` : undefined, animationDelay: `${index * 25}ms` }} />)}</span>;
}

function Metric({ title, value, href, pill, spark, children }: { title: string; value: ReactNode; href: string; pill: ReturnType<typeof trend> | null; spark: ReactNode; children: string }) {
  return <article className="home-metric">
    <header><h3>{title}</h3><Link href={href} aria-label={`Open ${title}`}><ArrowUpRight aria-hidden="true" /></Link></header>
    {spark}
    <div className="home-metric-value"><strong>{value}</strong>{pill && <span className={`home-pill is-${pill.tone}`}>{pill.text}</span>}</div>
    <p>{children}</p>
  </article>;
}

const average = (stats: HomeStats) => stats.activeDays > 0 ? stats.studySeconds / stats.activeDays : 0;
const lessonCount = (count: number) => `${count} ${count === 1 ? "lesson" : "lessons"}`;
const showDuration = (value: number) => <Duration seconds={value} />;
const metrics = [
  { title: "Study time", href: "/app/sessions", pick: (stats: HomeStats) => stats.studySeconds, alarm: true, show: showDuration, text: formatLearningDuration },
  { title: "Daily average", href: "/app/sessions", pick: average, alarm: true, show: showDuration, text: formatLearningDuration },
  { title: "Finished", href: "/app/library", pick: (stats: HomeStats) => stats.completed, alarm: false, show: String, text: lessonCount },
  { title: "Started", href: "/app/library", pick: (stats: HomeStats) => stats.started, alarm: false, show: String, text: lessonCount },
];

function Pulse({ name, pulse, lesson, next }: { name: string; pulse: HomePulse; lesson: LearnHomeData["continueWatching"]; next: HomeLesson | undefined }) {
  const [period, setPeriod] = useState<HomeRhythmPeriod>("week");
  const reduce = useReducedMotion();
  const { score, previousScore, days, current, previous, series } = pulse.periods[period];
  const since = pulse.firstDay ? `Since ${date(pulse.firstDay)}` : "Nothing yet";
  const studiedToday = pulse.periods.week.series.some(({ start, stats }) => start === pulse.today && stats.studySeconds > 0);
  const line = pulse.streak === 0 ? "Here is your learning rhythm" : `${pulse.streak}-day streak, ${studiedToday ? "nice work" : "keep it going"}`;
  return <aside className="home-pulse" aria-labelledby="home-greeting">
    <h2 id="home-greeting"><b>Hello, {name}</b><span>{line} {pulse.streak === 0 ? <span className="home-emoji is-wave" role="img" aria-label="smiling face">🙂</span> : <span className="home-emoji is-flame" role="img" aria-label="fire">🔥</span>}</span></h2>
    <fieldset className="home-pulse-tabs"><legend className="sr-only">Period</legend>{periods.map((item) => <button key={item.id} type="button" aria-pressed={period === item.id} onClick={() => setPeriod(item.id)}>
      {period === item.id && <motion.span layoutId="home-period" className="home-pulse-tab-on" transition={reduce ? { duration: 0 } : { type: "spring", bounce: .2, duration: .45 }} />}
      {item.label}
    </button>)}</fieldset>
    <Gauge key={period} score={score} previous={previousScore} caption={days > 0 ? `${band(score)} · studied ${current.activeDays} of ${days} ${days === 1 ? "day" : "days"}` : "No study yet"} />
    {lesson
      ? <Link className="home-black-button home-pulse-button" href={`/app/study/video/${lesson.sessionId}`}>Continue: {lesson.title}</Link>
      : next
        ? <StartStudyButton className="home-black-button home-pulse-button" resourceId={next.resourceId} origin="home" label={`Continue: ${next.title}`} />
        : <Link className="home-black-button home-pulse-button" href="/app/discover">Find your next lesson</Link>}
    <div className="home-metrics">
      {metrics.map((metric) => {
        const value = metric.pick(current);
        const before = previous && metric.pick(previous);
        return <Metric key={metric.title} title={metric.title} value={<Count value={value} show={metric.show} />} href={metric.href} pill={before === null ? null : trend(value, before, metric.alarm)} spark={<Spark values={series.map(({ start, stats }) => ({ key: start, value: metric.pick(stats) }))} />}>
          {before === null ? since : `${metric.text(before)} by now ${period === "week" ? "last week" : "last month"}`}
        </Metric>;
      })}
    </div>
  </aside>;
}

export function HomeDashboard({ home, name }: { home: LearnHomeData; name: string }) {
  const pulse = createHomePulse(home);
  const [filter, setFilter] = useState<LessonFilter | null>(null);
  const filters = [
    { id: "in_progress", value: pulse.totals.inProgress, label: "In progress", tone: "orange" },
    { id: "completed", value: pulse.totals.completed, label: "Completed", tone: "lime" },
  ] as const;
  const lessons = home.recentLessons.filter((lesson) => !filter || (filter === "completed") === (lesson.status === "completed")).slice(0, shownLessons);
  return <main className="home-dashboard" aria-label="Home">
    <div className="home-main">
      <ul className="home-counts">
        {filters.map((item) => <li key={item.id}><button type="button" className="home-count-pill" aria-pressed={filter === item.id} onClick={() => setFilter(filter === item.id ? null : item.id)}><span className={`home-count is-${item.tone}`}>{item.value}</span>{item.label}</button></li>)}
        <li className="home-counts-end"><Link className="home-count-pill home-library-link" href="/app/library">Library<span className="home-count"><ArrowUpRight aria-hidden="true" /></span></Link></li>
      </ul>
      <Lessons key={filter ?? "all"} lessons={lessons} today={pulse.today} empty={filter ? `No ${filter === "completed" ? "completed" : "in-progress"} lessons yet.` : "Your recent lessons will appear here."} />
      <div className="home-insights">
        <Week series={pulse.periods.week.series} today={pulse.today} />
        <StudyMix formats={pulse.formats} total={pulse.totals.studySeconds} />
      </div>
    </div>
    <Pulse name={name} pulse={pulse} lesson={home.continueWatching} next={home.recentLessons.find((lesson) => lesson.status !== "completed")} />
  </main>;
}
