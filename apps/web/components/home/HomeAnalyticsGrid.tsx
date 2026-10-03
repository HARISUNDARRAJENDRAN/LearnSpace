"use client";

import { BarChart3, ChartNoAxesCombined, ChartPie, ChevronDown, ChevronRight, Ellipsis, type LucideIcon, Play, X } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type PointerEventHandler, type ReactNode, useId, useRef, useState } from "react";
import type { AnalyticsTone, HomeAnalyticsData, TrendPeriod } from "../../lib/home/analytics";
import { YouTubeThumbnail } from "./YouTubeThumbnail";
import { formatLearningDuration } from "../../lib/home/duration";

function percent(value: number): string { return value > 0 && value < 1 ? "<1%" : `${Math.round(value)}%`; }

function EmptyState({ children }: { children: ReactNode }) { return <div className="analytics-empty">{children}</div>; }

function Legend({ label, tone }: { label: string; tone: AnalyticsTone }) {
  return <span className="analytics-legend"><i className={`analytics-swatch tone-${tone}`} />{label}</span>;
}

function AnalyticsCard({ area, title, icon: Icon, control, onPointerDown, children }: { area: string; title: string; icon: LucideIcon; control?: ReactNode; onPointerDown?: PointerEventHandler<HTMLElement>; children: ReactNode }) {
  const id = useId();
  return <section className={`analytics-card analytics-${area}`} aria-labelledby={id} onPointerDown={onPointerDown}>
    <header className="analytics-card-header"><span className="analytics-heading-icon"><Icon aria-hidden="true" /></span><h2 id={id}>{title}</h2>{control}</header>
    {children}
  </section>;
}

function Overflow({ title, children }: { title: string; children: ReactNode }) {
  return <details className="analytics-menu" onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
    <summary className="analytics-control analytics-overflow" aria-label={`${title} options`}><Ellipsis aria-hidden="true" /></summary>
    <div className="analytics-menu-panel">{children}</div>
  </details>;
}

function LearningOverviewCard({ data }: { data: HomeAnalyticsData["learningOverview"] }) {
  const maximum = Math.max(1, ...data.bars.map((bar) => bar.seconds));
  return <AnalyticsCard area="overview" title="Learning Overview" icon={BarChart3} control={<Overflow title="Learning Overview"><p>Your recorded study time. Weekly comparisons appear after a previous week of activity.</p><Link href="/app/sessions">View learning sessions <ChevronRight /></Link></Overflow>}>
    {data.seconds > 0 ? <div className="analytics-overview-body">
      <div className="analytics-overview-left"><div className="analytics-overview-legend"><Legend label="Previous weeks" tone="lavender" /><Legend label="This week" tone="green" /></div><div className="analytics-overview-metric">{data.changePct !== null ? <span className="analytics-status-badge">{data.changePct > 0 ? "+" : ""}{data.changePct}% this week</span> : <span className="analytics-status-badge">Your learning, underway</span>}<strong className="analytics-duration">{formatLearningDuration(data.seconds)}</strong><p>Recorded study time<br />{data.activeDays} active {data.activeDays === 1 ? "day" : "days"}</p></div></div>
      <div className="analytics-overview-chart">{data.bars.length > 0 ? <div className="analytics-bars" role="img" aria-label="Recorded study time over four weeks">{data.bars.map((bar, index) => <button type="button" aria-label={`${bar.label}: ${formatLearningDuration(bar.seconds)}`} key={bar.label} className={`analytics-bar tone-${index === 3 ? "green" : "lavender"}`} style={{ height: `${bar.seconds / maximum * 100}%`, animationDelay: `${index * 50}ms` }}><span className="analytics-dark-tooltip">{bar.label}<br />{formatLearningDuration(bar.seconds)}</span></button>)}</div> : <EmptyState>Your weekly overview will take shape as you study.</EmptyState>}</div>
    </div> : <EmptyState><strong>Your learning starts here.</strong><span>Study time and weekly activity will appear as you begin learning.</span></EmptyState>}
  </AnalyticsCard>;
}

function StudyDistributionCard({ data }: { data: HomeAnalyticsData["studyDistribution"] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogTitleId = useId();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const handleTouchOutside = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".analytics-bubble")) setActiveCategory(null);
  };
  const clearIfCurrent = (label: string) => setActiveCategory((current) => current === label ? null : current);
  if (data.length === 0) return <AnalyticsCard area="distribution" title="Study Distribution" icon={ChartPie}><EmptyState>Your study mix will appear as you spend time with learning material.</EmptyState></AnalyticsCard>;
  return <AnalyticsCard area="distribution" title="Study Distribution" icon={ChartPie} onPointerDown={handleTouchOutside} control={<button type="button" className="analytics-control" onClick={() => dialog.current?.showModal()}>View Details <ChevronRight /></button>}>
    <div className="analytics-distribution-chart">
      {/* biome-ignore lint/a11y/useSemanticElements: SVG is the chart container for interactive bubble controls. */}
      <svg viewBox="8 2 254 205" role="group" aria-label="Share of recorded study time by learning material.">
      {/* biome-ignore lint/a11y/useSemanticElements: Keep the keyboard target aligned to its SVG bubble. */}
      {data.map((item, index) => { const centers = data.length === 1 ? [[135, 104]] : data.length === 2 ? [[84, 95], [195, 110]] : [[84, 77], [198, 74], [160, 164], [112, 171]]; const center = centers[index] ?? [135, 104]; const position = [center[0], center[1], 75 * Math.sqrt(item.percent / 100)]; const emphasis = activeCategory === null ? "" : activeCategory === item.label ? " is-active" : " is-muted"; return <g key={item.label} data-category={item.label} className={`analytics-bubble tone-${item.tone}${emphasis}`} role="button" aria-label={`${item.label}, ${percent(item.percent)}, ${formatLearningDuration(item.seconds)}`} aria-pressed={activeCategory === item.label} tabIndex={0} onPointerEnter={(event) => { if (event.pointerType !== "touch") setActiveCategory(item.label); }} onPointerLeave={(event) => { if (event.pointerType !== "touch" && !event.currentTarget.matches(":focus-visible")) clearIfCurrent(item.label); }} onPointerDown={(event) => { if (event.pointerType === "touch") setActiveCategory((current) => current === item.label ? null : item.label); }} onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) setActiveCategory(item.label); }} onBlur={() => clearIfCurrent(item.label)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActiveCategory(item.label); } }}><title>{`${item.label}: ${percent(item.percent)} · ${formatLearningDuration(item.seconds)}`}</title><circle cx={position[0]} cy={position[1]} r={position[2]} style={{ animationDelay: `${index * 55}ms` }} /><text x={position[0]} y={position[1]} dy=".35em" textAnchor="middle" fontSize={index === 0 ? 19 : index === 3 ? 10 : 16}>{(position[2] ?? 0) >= 18 ? percent(item.percent) : ""}</text></g>; })}
      </svg>
    </div>
    <ul className="analytics-distribution-stats">{data.map((item) => <li key={item.label} className={activeCategory === null ? "" : activeCategory === item.label ? "is-active" : "is-muted"} onMouseEnter={() => setActiveCategory(item.label)} onMouseLeave={() => clearIfCurrent(item.label)}><Legend label={item.label} tone={item.tone} /><strong>{formatLearningDuration(item.seconds)}</strong></li>)}</ul>
    <dialog ref={dialog} className="analytics-dialog" aria-labelledby={dialogTitleId} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }} onKeyDown={(event) => { if (event.key === "Escape") dialog.current?.close(); }}><header><h3 id={dialogTitleId}>Study Distribution</h3><button type="button" aria-label="Close details" onClick={() => dialog.current?.close()}><X /></button></header><p>Your recorded study time, grouped by learning material. Each interval is counted once.</p>{data.map((item) => <div className="analytics-detail-row" key={item.label}><Legend label={item.label} tone={item.tone} /><strong>{formatLearningDuration(item.seconds)}</strong><span>{percent(item.percent)}</span></div>)}<Link href="/app/sessions">View your learning sessions <ChevronRight /></Link></dialog>
  </AnalyticsCard>;
}

function ContinueWatchingCard({ item }: { item: HomeAnalyticsData["continueWatching"] }) {
  const progress = item ? Math.max(0, Math.min(100, Math.round(item.progressPct))) : 0;
  return <AnalyticsCard area="continue" title="Continue Watching" icon={Play}>
    {item ? <div className="analytics-continue-body">
      <Link className="analytics-continue-lesson" href={`/app/study/video/${item.sessionId}`} title={item.title}>
        <span className="analytics-continue-media">
          <YouTubeThumbnail fill src={item.thumbnailUrl ?? ""} fallbackSrc={item.thumbnailFallbackUrl} alt="" sizes="80px" />
        </span>
        <span className="analytics-continue-details">
          <span className="analytics-continue-channel">{item.channelTitle ?? "Video lesson"}</span>
          <span className="analytics-continue-title">{item.title}</span>
        </span>
        <ChevronRight className="analytics-continue-open" aria-hidden="true" />
      </Link>
      <div className="analytics-continue-dial">
        <svg viewBox="0 0 240 160" role="progressbar" aria-label={`Progress for ${item.title}`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <path className="analytics-continue-ticks" d="M 15 120 A 105 105 0 0 1 225 120" pathLength="100" />
          <path className="analytics-continue-track" d="M 30 120 A 90 90 0 0 1 210 120" pathLength="100" />
          <path className="analytics-continue-arc" d="M 30 120 A 90 90 0 0 1 210 120" pathLength="100" strokeDasharray={`${progress} 100`} />
          <text x="30" y="145" textAnchor="middle">0</text>
          <text x="210" y="145" textAnchor="middle">100%</text>
        </svg>
        <Link className="analytics-continue-resume" href={`/app/study/video/${item.sessionId}`}>
          <span><Play aria-hidden="true" fill="currentColor" /></span>
          Resume
        </Link>
      </div>
      <div className="analytics-continue-caption"><strong>{progress}<span>%</span></strong><span>of this lesson, explored.</span></div>
    </div> : <div className="analytics-empty"><strong>Your next lesson awaits.</strong><span>Videos you start will appear here, ready to resume.</span><Link href="/app/discover">Explore resources <ChevronRight /></Link></div>}
  </AnalyticsCard>;
}

type WeeklySegmentId = "focus" | "practice" | "research";

function WeeklyProgressCard({ data }: { data: HomeAnalyticsData["weeklyProgress"] }) {
  const [period, setPeriod] = useState(0);
  const selected = data[period] ?? data[0];
  const [active, setActive] = useState<WeeklySegmentId | null>(null);
  if (!selected) return null;
  const definitions = [
    { id: "focus", tone: "lavender", label: "Focus" },
    { id: "practice", tone: "green", label: "Practice" },
    { id: "research", tone: "light-lavender", label: "Research" },
  ] as const;
  let angle = -90;
  const count = selected.segments.filter((value) => value > 0).length;
  const arcs = definitions.flatMap((definition, index) => {
    const seconds = selected.segments[index] ?? 0;
    if (!seconds || !selected.seconds) return [];
    const share = seconds / selected.seconds * 100;
    const extent = share * 3.6;
    const gap = count > 1 ? Math.min(6, extent / 4) : .01;
    const start = angle + gap / 2;
    const end = angle + extent - gap / 2;
    const sweep = Math.max(.01, end - start);
    const radians = (start + sweep / 2) * Math.PI / 180;
    const point = (value: number, radius: number) => [130 + Math.cos(value * Math.PI / 180) * radius, 110 + Math.sin(value * Math.PI / 180) * radius];
    const from = point(start, 70);
    const to = point(start + sweep, 70);
    const leaderFrom = point(start + sweep / 2, 84);
    const leaderTo = point(start + sweep / 2, 99);
    angle += extent;
    return [{ ...definition, share, seconds, midAngle: (start + sweep / 2), path: `M ${from[0]} ${from[1]} A 70 70 0 ${sweep > 180 ? 1 : 0} 1 ${to[0]} ${to[1]}`, leader: `M ${leaderFrom[0]} ${leaderFrom[1]} L ${leaderTo[0]} ${leaderTo[1]}`, x: Math.max(15, Math.min(245, 130 + Math.cos(radians) * 113)), y: Math.max(14, Math.min(215, 114 + Math.sin(radians) * 113)) }];
  });
  const handleTouchOutside = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".analytics-ring-hit-target, .analytics-ring-legend button")) setActive(null);
  };
  const activateForKeyboard = (id: WeeklySegmentId, element: SVGPathElement | HTMLButtonElement) => {
    if (element.matches(":focus-visible")) setActive(id);
  };
  const clearIfCurrent = (id: WeeklySegmentId) => setActive((current) => current === id ? null : current);
  return <AnalyticsCard area="progress" title="Weekly Progress" icon={ChartPie} onPointerDown={handleTouchOutside} control={<label className="analytics-control analytics-select-control"><select aria-label="Progress period" value={period} onChange={(event) => { setPeriod(Number(event.target.value)); setActive(null); }}>{data.map((item, index) => <option value={index} key={item.label}>{item.label}</option>)}</select><ChevronDown aria-hidden="true" /></label>}>
    {selected.seconds > 0 ? <>
    <div className="analytics-ring"><svg viewBox="0 0 260 220" aria-label={`${formatLearningDuration(selected.seconds)} recorded study time, ${selected.label.toLowerCase()}`}>
      {arcs.map((arc, index) => {
        const radians = arc.midAngle * Math.PI / 180;
        const offsetStyle = { "--segment-offset-x": `${(Math.cos(radians) * 5).toFixed(3)}px`, "--segment-offset-y": `${(Math.sin(radians) * 5).toFixed(3)}px` } as CSSProperties;
        const emphasis = active === null ? "" : active === arc.id ? " is-active" : " is-muted";
        return <g key={arc.id} className={`analytics-ring-segment tone-${arc.tone}${emphasis}`} style={offsetStyle}>
          {/* biome-ignore lint/a11y/useSemanticElements: Keep this keyboard target aligned to its SVG arc-shaped hit region. */}
          <path className="analytics-ring-hit-target" d={arc.path} fill="none" stroke="transparent" strokeWidth="28" strokeLinecap="butt" pointerEvents="stroke" role="button" tabIndex={0} aria-label={`${arc.label}, ${percent(arc.share)}, ${formatLearningDuration(arc.seconds)}`} aria-pressed={active === arc.id} onPointerEnter={(event) => { if (event.pointerType !== "touch") setActive(arc.id); }} onPointerLeave={(event) => { if (event.pointerType !== "touch" && !event.currentTarget.matches(":focus-visible")) clearIfCurrent(arc.id); }} onPointerDown={(event) => { if (event.pointerType === "touch") setActive((current) => current === arc.id ? null : arc.id); }} onFocus={(event) => activateForKeyboard(arc.id, event.currentTarget)} onBlur={() => clearIfCurrent(arc.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(arc.id); } }} onClick={(event) => { if (event.detail === 0) setActive(arc.id); }} />
          <path pathLength={1} className="analytics-ring-arc" d={arc.path} fill="none" strokeWidth="18" strokeLinecap="round" pointerEvents="none" style={{ animationDelay: `${index * 80}ms` }} />
        </g>;
      })}
      <g className="analytics-ring-leaders">{arcs.map((arc) => <path key={arc.id} className={`analytics-ring-linked${active === null ? "" : active === arc.id ? " is-active" : " is-muted"}`} d={arc.leader} />)}</g>
      <g className="analytics-ring-annotations">{arcs.map((arc) => <text key={arc.id} x={arc.x} y={arc.y} textAnchor="middle" className={`analytics-ring-linked${active === null ? "" : active === arc.id ? " is-active" : " is-muted"}`}>{percent(arc.share)}</text>)}</g>
      <g className="analytics-ring-center"><text className="analytics-ring-value" x="130" y="108" textAnchor="middle">{formatLearningDuration(selected.seconds)}</text><text className="analytics-ring-caption" x="130" y="129" textAnchor="middle">Study time</text><text className="analytics-ring-caption" x="130" y="146" textAnchor="middle">{selected.completed > 0 ? `${selected.completed} completed` : selected.resources > 0 ? `${selected.resources} explored` : ""}</text></g>
    </svg></div>
    <div className="analytics-ring-legend">{arcs.map((arc) => <button key={arc.id} title={`${formatLearningDuration(arc.seconds)} · ${percent(arc.share)}`} className={`analytics-ring-linked${active === null ? "" : active === arc.id ? " is-active" : " is-muted"}`} type="button" onPointerEnter={(event) => { if (event.pointerType !== "touch") setActive(arc.id); }} onPointerLeave={(event) => { if (event.pointerType !== "touch" && !event.currentTarget.matches(":focus-visible")) clearIfCurrent(arc.id); }} onPointerDown={(event) => { if (event.pointerType === "touch") setActive((current) => current === arc.id ? null : arc.id); }} onFocus={(event) => activateForKeyboard(arc.id, event.currentTarget)} onBlur={() => clearIfCurrent(arc.id)} onClick={(event) => { if (event.detail === 0) setActive(arc.id); }}><Legend label={arc.label} tone={arc.tone} /></button>)}</div>
    </> : <EmptyState>{selected.resources > 0 || selected.completed > 0 ? <><strong>{selected.resources} {selected.resources === 1 ? "resource" : "resources"} explored · {selected.completed} completed</strong><span>Recorded study time will appear as you learn.</span></> : "Your progress will appear as you complete learning sessions."}</EmptyState>}
  </AnalyticsCard>;
}

function LearningActivityTrendsCard({ data }: { data: HomeAnalyticsData["activityTrends"] }) {
  const [period, setPeriod] = useState<TrendPeriod>(data.Month.filter((point) => point.seconds > 0).length >= 2 ? "Month" : "Day");
  const [active, setActive] = useState<number | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const points = data[period];
  const activeIndex = Math.max(0, Math.min(active ?? points.findLastIndex((point) => point.seconds > 0), points.length - 1));
  const selected = points[activeIndex];
  const step = 402 / Math.max(1, points.length * 3 - 1);
  const maximum = Math.max(1, ...points.flatMap((point) => point.segments));
  const unit = maximum >= 3600 ? 900 : maximum >= 60 ? 60 : 4;
  const scale = Math.ceil(maximum / unit) * unit;
  const activeX = 60 + (activeIndex * 3 + 1) * step;
  const activeY = 212 - Math.max(0, ...(selected?.segments ?? [])) / scale * 190;
  const series = [{ label: "Focus", tone: "lavender" }, { label: "Practice", tone: "green" }, { label: "Research", tone: "light-lavender" }] as const;
  const hasHistory = points.filter((point) => point.seconds > 0).length >= 2;
  return <AnalyticsCard area="trends" title="Learning Activity & Progress Trends" icon={ChartNoAxesCombined} control={<fieldset className="analytics-segments"><legend className="analytics-visually-hidden">Trend period</legend>{(["Day", "Month", "Year"] as const).map((value) => <button key={value} type="button" aria-pressed={period === value} onClick={() => { setPeriod(value); setActive(null); }}>{value}</button>)}</fieldset>}>
    {hasHistory ? <>
    <div className="analytics-trend-legends">{series.map((item) => <button key={item.label} type="button" aria-pressed={!hidden.includes(item.label)} onClick={() => setHidden((current) => current.includes(item.label) ? current.filter((label) => label !== item.label) : [...current, item.label])}><Legend {...item} /></button>)}</div>
    <div className="analytics-trend-chart"><svg viewBox="0 0 485 238" role="img" aria-label={`${period} recorded study time by activity type`}>
      {[0, 1, 2, 3, 4].map((tick) => { const y = 212 - tick / 4 * 190; return <g key={tick} className="analytics-gridline"><line x1="57" x2="479" y1={y} y2={y} /><text x="3" y={y + 3}>{formatLearningDuration(scale * tick / 4)}</text></g>; })}
      {points.map((point, bucket) => <g key={point.title}>{point.segments.map((seconds, column) => {
        const item = series[column];
        if (!item || seconds <= 0) return null;
        const count = Math.ceil(seconds / scale * 11);
        return Array.from({ length: count }, (_, row) => {
          const cx = 60 + (bucket * 3 + column) * step;
          const cy = 212 - seconds / scale * 190 * (count === 1 ? 1 : row / (count - 1));
          return <circle key={`${cx}-${cy}`} className={`analytics-trend-dot tone-${item.tone}${hidden.includes(item.label) ? " is-hidden" : activeIndex === bucket ? " is-active" : ""}`} cx={cx} cy={cy} r="7.5" style={{ animationDelay: `${bucket * 14 + row * 3}ms` }} />;
        });
      })}<text className="analytics-axis-label" x={60 + (bucket * 3 + 1) * step} y="232" textAnchor="middle">{point.label}</text></g>)}
      {selected && <circle className="analytics-trend-marker" cx={activeX} cy={activeY} r="2.5" />}
    </svg><div className="analytics-chart-targets">{points.map((point, index) => <button key={point.title} type="button" onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)} aria-label={`${point.title}: ${formatLearningDuration(point.seconds)}, ${point.completed} completed, ${point.resources} resources explored`} />)}</div>
      {selected && <div className="analytics-chart-tooltip" role="status" style={{ left: `${Math.min(77, activeX / 485 * 100 + 2)}%`, top: `${Math.max(0, activeY / 238 * 100 - 13)}%` }}><strong>{selected.title}</strong><div><Legend label="Resources" tone="green" /><b>{selected.resources}</b></div><div><Legend label="Completed" tone="light-lavender" /><b>{selected.completed}</b></div><div><Legend label="Study Time" tone="lavender" /><b>{formatLearningDuration(selected.seconds)}</b></div></div>}
    </div>
    </> : <EmptyState>Your learning trends will appear as you complete more sessions.</EmptyState>}
  </AnalyticsCard>;
}

export function HomeAnalyticsGrid({ data }: { data: HomeAnalyticsData }) {
  return <main className="home-dashboard" aria-label="Learning analytics dashboard"><div className="home-analytics-grid">
    <LearningOverviewCard data={data.learningOverview} /><StudyDistributionCard data={data.studyDistribution} /><WeeklyProgressCard data={data.weeklyProgress} /><ContinueWatchingCard item={data.continueWatching} /><LearningActivityTrendsCard data={data.activityTrends} />
  </div></main>;
}
