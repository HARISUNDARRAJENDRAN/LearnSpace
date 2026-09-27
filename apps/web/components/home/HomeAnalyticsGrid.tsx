"use client";

import { BarChart3, ChartNoAxesCombined, ChartPie, ChevronDown, ChevronRight, Ellipsis, type LucideIcon, Play, X } from "lucide-react";
import Link from "next/link";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, type PointerEventHandler, type ReactNode, useId, useRef, useState } from "react";
import type { AnalyticsTone, HomeAnalyticsData, TrendPeriod } from "../../lib/home/analytics";
import { YouTubeThumbnail } from "./YouTubeThumbnail";

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
  return <AnalyticsCard area="overview" title="Learning Overview" icon={BarChart3} control={<Overflow title="Learning Overview"><p>Sample analytics · comparative study activity.</p><Link href="/app/sessions">View learning sessions <ChevronRight /></Link></Overflow>}>
    <div className="analytics-overview-body">
      <div className="analytics-overview-left"><div className="analytics-overview-legend"><Legend label="Study activity" tone="lavender" /><Legend label="Consistency" tone="green" /></div><div className="analytics-overview-metric"><span className="analytics-status-badge">{data.badge}</span><strong>+{data.activity}%</strong><p>Learning activity<br />vs. last week</p></div></div>
      <div className="analytics-overview-chart"><div className="analytics-bars" role="img" aria-label="Sample study activity consistency over four weeks">{data.bars.map((height, index) => <button type="button" aria-label={`Week ${index + 1}: ${height}% consistency`} key={height} className={`analytics-bar tone-${index % 2 ? "green" : "lavender"}`} style={{ height: `${height}%`, animationDelay: `${index * 50}ms` }}><span className="analytics-dark-tooltip">Week {index + 1}<br />{height}% consistency</span></button>)}</div></div>
    </div>
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
  return <AnalyticsCard area="distribution" title="Study Distribution" icon={ChartPie} onPointerDown={handleTouchOutside} control={<button type="button" className="analytics-control" onClick={() => dialog.current?.showModal()}>View Details <ChevronRight /></button>}>
    <div className="analytics-distribution-chart">
      {/* biome-ignore lint/a11y/useSemanticElements: SVG is the chart container for interactive bubble controls. */}
      <svg viewBox="0 0 270 235" role="group" aria-label="Study distribution chart. Categories overlap.">
      {/* biome-ignore lint/a11y/useSemanticElements: Keep the keyboard target aligned to its SVG bubble. */}
      {data.map((item, index) => { const position = [[84, 77, 70], [198, 74, 58], [160, 164, 45], [112, 171, 28]][index] ?? [0, 0, 0]; const emphasis = activeCategory === null ? "" : activeCategory === item.label ? " is-active" : " is-muted"; return <g key={item.label} data-category={item.label} className={`analytics-bubble tone-${item.tone}${emphasis}`} role="button" aria-label={`${item.label}, ${item.percent} percent, ${item.duration}`} aria-pressed={activeCategory === item.label} tabIndex={0} onPointerEnter={(event) => { if (event.pointerType !== "touch") setActiveCategory(item.label); }} onPointerLeave={(event) => { if (event.pointerType !== "touch" && !event.currentTarget.matches(":focus-visible")) clearIfCurrent(item.label); }} onPointerDown={(event) => { if (event.pointerType === "touch") setActiveCategory((current) => current === item.label ? null : item.label); }} onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) setActiveCategory(item.label); }} onBlur={() => clearIfCurrent(item.label)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActiveCategory(item.label); } }}><title>{`${item.label}: ${item.percent}% · ${item.duration}`}</title><circle cx={position[0]} cy={position[1]} r={position[2]} style={{ animationDelay: `${index * 55}ms` }} /><text x={position[0]} y={position[1]} dy=".35em" textAnchor="middle" fontSize={index === 0 ? 19 : index === 3 ? 10 : 16}>{item.percent}%</text></g>; })}
      </svg>
    </div>
    <ul className="analytics-distribution-stats">{[data[0], data[1], data[3], data[2]].map((item) => item && <li key={item.label} className={activeCategory === null ? "" : activeCategory === item.label ? "is-active" : "is-muted"} onMouseEnter={() => setActiveCategory(item.label)} onMouseLeave={() => clearIfCurrent(item.label)}><Legend label={item.label} tone={item.tone} /><strong>{item.duration}</strong></li>)}</ul>
    <dialog ref={dialog} className="analytics-dialog" aria-labelledby={dialogTitleId} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }} onKeyDown={(event) => { if (event.key === "Escape") dialog.current?.close(); }}><header><h3 id={dialogTitleId}>Study Distribution</h3><button type="button" aria-label="Close details" onClick={() => dialog.current?.close()}><X /></button></header><p>Sample analytics. Categories can overlap; these percentages are not a partition of total study time.</p>{data.map((item) => <div className="analytics-detail-row" key={item.label}><Legend label={item.label} tone={item.tone} /><strong>{item.duration}</strong><span>{item.percent}%</span></div>)}<Link href="/app/sessions">View your learning sessions <ChevronRight /></Link></dialog>
  </AnalyticsCard>;
}

function ContinueWatchingCard({ item }: { item: HomeAnalyticsData["continueWatching"] }) {
  const progress = item ? Math.max(0, Math.min(100, Math.round(item.progressPct))) : 0;
  return <AnalyticsCard area="continue" title="Continue Watching" icon={Play} control={item ? <Link className="analytics-control" href={`/app/study/video/${item.sessionId}`}>Resume <ChevronRight /></Link> : undefined}>
    {item ? <div className="analytics-continue-body">
      <Link className="analytics-continue-media" href={`/app/study/video/${item.sessionId}`} aria-label={`Resume ${item.title}`}>
        <YouTubeThumbnail fill src={item.thumbnailUrl ?? ""} fallbackSrc={item.thumbnailFallbackUrl} alt={`Thumbnail for ${item.title}`} sizes="(min-width: 1280px) 28vw, (min-width: 768px) 40vw, 100vw" />
        <span className="analytics-continue-play"><Play aria-hidden="true" fill="currentColor" /></span>
        {item.durationMs && item.durationMs > 0 ? <span className="analytics-continue-duration">{Math.floor(item.durationMs / 3_600_000) > 0 ? `${Math.floor(item.durationMs / 3_600_000)}:${String(Math.floor(item.durationMs / 60_000) % 60).padStart(2, "0")}` : `${Math.floor(item.durationMs / 60_000)}:${String(Math.floor(item.durationMs / 1_000) % 60).padStart(2, "0")}`}</span> : null}
      </Link>
      <div className="analytics-continue-details">
        <Link className="analytics-continue-title" href={`/app/study/video/${item.sessionId}`} title={item.title}>{item.title}</Link>
        <span className="analytics-continue-channel">{item.channelTitle ?? "Video lesson"}</span>
        {item.description ? <p>{item.description}</p> : null}
        <div className="analytics-continue-progress-label"><span>In progress</span><strong>{progress}%</strong></div>
        <div className="analytics-continue-progress" role="progressbar" aria-label={`Progress for ${item.title}`} aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
      </div>
    </div> : <div className="analytics-empty">No video in progress.<Link href="/app/discover">Explore resources <ChevronRight /></Link></div>}
  </AnalyticsCard>;
}

type WeeklySegmentId = "focus" | "practice" | "research";

function WeeklyProgressCard({ data }: { data: HomeAnalyticsData["weeklyProgress"] }) {
  const [period, setPeriod] = useState(0);
  const selected = data[period] ?? data[0];
  const [active, setActive] = useState<WeeklySegmentId | null>(null);
  if (!selected) return null;
  const arcs = [
    { id: "focus", path: "M 60 104 A 70 70 0 0 1 155 50", tone: "lavender", label: "Focus", midAngle: -119.6, leader: "M 79 48 L 65 34 L 50 34", x: 23, y: 38 },
    { id: "practice", path: "M 178 59 A 70 70 0 0 1 159 174", tone: "green", label: "Practice", midAngle: 9.4, leader: "M 202 96 L 214 82 L 230 82", x: 233, y: 86 },
    { id: "research", path: "M 136 181 A 70 70 0 0 1 62 126", tone: "light-lavender", label: "Research", midAngle: 126.7, leader: "M 58 145 L 45 158 L 29 158", x: 7, y: 162 },
  ] as const;
  const handleTouchOutside = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "touch") return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".analytics-ring-hit-target, .analytics-ring-legend button")) setActive(null);
  };
  const activateForKeyboard = (id: WeeklySegmentId, element: SVGPathElement | HTMLButtonElement) => {
    if (element.matches(":focus-visible")) setActive(id);
  };
  const clearIfCurrent = (id: WeeklySegmentId) => setActive((current) => current === id ? null : current);
  return <AnalyticsCard area="progress" title="Weekly Progress" icon={ChartPie} onPointerDown={handleTouchOutside} control={<label className="analytics-control analytics-select-control"><select aria-label="Progress period" value={period} onChange={(event) => setPeriod(Number(event.target.value))}>{data.map((item, index) => <option value={index} key={item.label}>{item.label}</option>)}</select><ChevronDown aria-hidden="true" /></label>}>
    <div className="analytics-ring"><svg viewBox="0 0 260 220" aria-label={`${selected.progress}% learning progress, ${selected.label.toLowerCase()}, sample data`}>
      {arcs.map((arc, index) => {
        const radians = arc.midAngle * Math.PI / 180;
        const offsetStyle = { "--segment-offset-x": `${Math.cos(radians) * 5}px`, "--segment-offset-y": `${Math.sin(radians) * 5}px` } as CSSProperties;
        const emphasis = active === null ? "" : active === arc.id ? " is-active" : " is-muted";
        return <g key={arc.id} className={`analytics-ring-segment tone-${arc.tone}${emphasis}`} style={offsetStyle}>
          {/* biome-ignore lint/a11y/useSemanticElements: Keep this keyboard target aligned to its SVG arc-shaped hit region. */}
          <path className="analytics-ring-hit-target" d={arc.path} fill="none" stroke="transparent" strokeWidth="28" strokeLinecap="butt" pointerEvents="stroke" role="button" tabIndex={0} aria-label={`${arc.label}, ${selected.shares[index]} percent`} onPointerEnter={(event) => { if (event.pointerType !== "touch") setActive(arc.id); }} onPointerLeave={(event) => { if (event.pointerType !== "touch" && !event.currentTarget.matches(":focus-visible")) clearIfCurrent(arc.id); }} onPointerDown={(event) => { if (event.pointerType === "touch") setActive((current) => current === arc.id ? null : arc.id); }} onFocus={(event) => activateForKeyboard(arc.id, event.currentTarget)} onBlur={() => clearIfCurrent(arc.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(arc.id); } }} onClick={(event) => { if (event.detail === 0) setActive(arc.id); }} />
          <path pathLength={1} className="analytics-ring-arc" d={arc.path} fill="none" strokeWidth="18" strokeLinecap="round" pointerEvents="none" style={{ animationDelay: `${index * 80}ms` }} />
        </g>;
      })}
      <g className="analytics-ring-leaders">{arcs.map((arc) => <path key={arc.id} className={`analytics-ring-linked${active === null ? "" : active === arc.id ? " is-active" : " is-muted"}`} d={arc.leader} />)}</g>
      <g className="analytics-ring-annotations">{arcs.map((arc, index) => <text key={arc.id} className={`analytics-ring-linked${active === null ? "" : active === arc.id ? " is-active" : " is-muted"}`} x={arc.x} y={arc.y}>{selected.shares[index]}%</text>)}</g>
      <g className="analytics-ring-center"><text className="analytics-ring-value" x="130" y="107" textAnchor="middle">{selected.progress}%</text><text className="analytics-ring-caption" x="130" y="130" textAnchor="middle">Learning Progress</text></g>
    </svg></div><div className="analytics-ring-legend">{arcs.map((arc) => <button key={arc.id} className={`analytics-ring-linked${active === null ? "" : active === arc.id ? " is-active" : " is-muted"}`} type="button" onPointerEnter={(event) => { if (event.pointerType !== "touch") setActive(arc.id); }} onPointerLeave={(event) => { if (event.pointerType !== "touch" && !event.currentTarget.matches(":focus-visible")) clearIfCurrent(arc.id); }} onPointerDown={(event) => { if (event.pointerType === "touch") setActive((current) => current === arc.id ? null : arc.id); }} onFocus={(event) => activateForKeyboard(arc.id, event.currentTarget)} onBlur={() => clearIfCurrent(arc.id)} onClick={(event) => { if (event.detail === 0) setActive(arc.id); }}><Legend label={arc.label} tone={arc.tone} /></button>)}</div>
  </AnalyticsCard>;
}

function LearningActivityTrendsCard({ data }: { data: HomeAnalyticsData["activityTrends"] }) {
  const [period, setPeriod] = useState<TrendPeriod>("Month");
  const [active, setActive] = useState(6);
  const [hidden, setHidden] = useState<string[]>([]);
  const points = data[period];
  const selected = points[active];
  const step = 452 / (points.length * 3 - 1);
  const activeX = 24 + (active * 3 + 2) * step;
  const activeY = 205 - ((selected?.stacks[2] ?? 1) - 1) * 17;
  const series = [{ label: "Study Time", tone: "lavender" }, { label: "Completed", tone: "light-lavender" }, { label: "Resources", tone: "green" }] as const;
  return <AnalyticsCard area="trends" title="Learning Activity & Progress Trends" icon={ChartNoAxesCombined} control={<fieldset className="analytics-segments"><legend className="analytics-visually-hidden">Trend period</legend>{(["Day", "Month", "Year"] as const).map((value) => <button key={value} type="button" aria-pressed={period === value} onClick={() => { setPeriod(value); setActive(value === "Month" ? 6 : 2); }}>{value}</button>)}</fieldset>}>
    <div className="analytics-trend-legends">{series.map((item) => <button key={item.label} type="button" aria-pressed={!hidden.includes(item.label)} onClick={() => setHidden((current) => current.includes(item.label) ? current.filter((label) => label !== item.label) : [...current, item.label])}><Legend {...item} /></button>)}</div>
    <div className="analytics-trend-chart"><svg viewBox="0 0 485 238" role="img" aria-label={`${period} learning activity bubble chart, sample data`}>
      {[0, 4, 8, 12, 16, 20, 24].map((tick) => { const y = 212 - tick / 24 * 190; return <g key={tick} className="analytics-gridline"><line x1="21" x2="479" y1={y} y2={y} /><text x="3" y={y + 3}>{period === "Year" ? tick * 20 : period === "Day" ? tick / 4 : tick}h</text></g>; })}
      {points.map((point, month) => <g key={point.label}>{point.stacks.map((height, column) => Array.from({ length: height }, (_, row) => { const seriesIndex = row < Math.ceil(height * .4) ? 0 : row < Math.ceil(height * .7) ? 1 : 2; const item = series[seriesIndex]; const cx = 24 + (month * 3 + column) * step; const cy = 205 - row * 17; return <circle key={`${cx}-${cy}`} className={`analytics-trend-dot tone-${item.tone}${hidden.includes(item.label) ? " is-hidden" : active === month ? " is-active" : ""}`} cx={cx} cy={cy} r="7.5" style={{ animationDelay: `${month * 14 + row * 3}ms` }} />; }))}<text className="analytics-axis-label" x={24 + (month * 3 + 1) * step} y="232" textAnchor="middle">{point.label}</text></g>)}
      {selected && <circle className="analytics-trend-marker" cx={activeX} cy={activeY} r="2.5" />}
    </svg><div className="analytics-chart-targets">{points.map((point, index) => <button key={point.label} type="button" onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)} aria-label={`${point.title}: ${point.hours} hours, ${point.completed} completed, ${point.resources} resources`} />)}</div>
      {selected && <div className="analytics-chart-tooltip" role="status" style={{ left: `${Math.min(77, activeX / 485 * 100 + 2)}%`, top: `${Math.max(0, activeY / 238 * 100 - 13)}%` }}><strong>{selected.title}</strong><div><Legend label="Resources" tone="green" /><b>{selected.resources}</b></div><div><Legend label="Completed" tone="light-lavender" /><b>{selected.completed}</b></div><div><Legend label="Study Time" tone="lavender" /><b>{selected.hours}h</b></div></div>}
    </div>
  </AnalyticsCard>;
}

export function HomeAnalyticsGrid({ data }: { data: HomeAnalyticsData }) {
  return <main className="home-dashboard" aria-label="Learning analytics dashboard"><div className="home-analytics-grid">
    <LearningOverviewCard data={data.learningOverview} /><StudyDistributionCard data={data.studyDistribution} /><WeeklyProgressCard data={data.weeklyProgress} /><ContinueWatchingCard item={data.continueWatching} /><LearningActivityTrendsCard data={data.activityTrends} />
  </div></main>;
}
