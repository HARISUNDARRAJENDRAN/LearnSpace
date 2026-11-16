import type { CurriculumItem } from "@learnspace/shared";
import { ArrowRight, ArrowUpRight, Check, Clock, FileText, Lightbulb, Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import type { DiscoverItem, DiscoverTrackSummary, ResearchDiscoverData, ResearchTrackPageData } from "../../lib/research/discover";
import { StartStudyButton } from "../study/StudyActions";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const trackHref = (id: string) => `/app/research/discover/${id}`;

function TrackMeta({ summary }: { summary: DiscoverTrackSummary }) {
  return <p className="discover-track-meta"><span><Clock aria-hidden="true" />~{summary.track.estimatedHours} h</span><span><FileText aria-hidden="true" />{plural(summary.paperCount, "paper")}</span><span><Lightbulb aria-hidden="true" />{plural(summary.conceptCount, "concept")}</span></p>;
}

function Progress({ value, label }: { value: number; label: string }) {
  return <div className="discover-progress" role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

function TrackCard({ summary }: { summary: DiscoverTrackSummary }) {
  const { track } = summary;
  return <li>
    <Link className="discover-track-card" href={trackHref(track.id)}>
      <span className="discover-track-stages" aria-hidden="true">{track.modules.map((module) => <span key={module.id} title={module.title} />)}</span>
      <strong>{track.title}</strong>
      <span className="discover-track-audience">{track.audience}</span>
      <TrackMeta summary={summary} />
      {summary.started ? <><Progress value={summary.progressPct} label={`${track.title} progress`} /><small>{summary.progressPct}% of required papers read</small></> : null}
    </Link>
  </li>;
}

/** Research Discover: learning paths through the papers that built a field, ordered so each one makes sense. */
export function ResearchDiscover({ data }: { data: ResearchDiscoverData }) {
  const featured = data.tracks.find(({ track }) => track.id === data.recommendedTrackId) ?? null;
  return <main className="research-page discover-page">
    <header className="discover-intro">
      <p className="discover-eyebrow">Learning paths</p>
      <h1>Read the papers that built the field, in the order that makes them click.</h1>
      <p>Each path climbs from the concepts you need to the papers that defined the idea, with the sections worth your time and what each one teaches.</p>
    </header>
    {featured ? <section className="discover-featured" aria-labelledby="discover-featured-title">
      <div>
        <p className="discover-eyebrow"><Sparkles aria-hidden="true" />{featured.started ? "Continue your path" : "Picked for you"}</p>
        <h2 id="discover-featured-title">{featured.track.title}</h2>
        <p className="discover-track-audience">{featured.track.audience}</p>
        <TrackMeta summary={featured} />
        {featured.started ? <Progress value={featured.progressPct} label={`${featured.track.title} progress`} /> : null}
      </div>
      <div className="discover-featured-side">
        <p className="discover-label">You will be able to</p>
        <ul className="discover-outcomes">{featured.track.outcomes.slice(0, 4).map((outcome) => <li key={outcome}><Check aria-hidden="true" />{outcome}</li>)}</ul>
        <Link className="discover-cta" href={trackHref(featured.track.id)}>{featured.next ? <>Next: {featured.next.title}</> : "Open the path"}<ArrowRight aria-hidden="true" /></Link>
      </div>
    </section> : null}
    <section aria-labelledby="discover-all-title">
      <div className="discover-section-heading"><h2 id="discover-all-title">All paths</h2><p>{plural(data.tracks.length, "path")}</p></div>
      <ul className="discover-track-grid">{data.tracks.map((summary) => <TrackCard key={summary.track.id} summary={summary} />)}</ul>
    </section>
  </main>;
}

const STATUS_LABEL: Record<DiscoverItem["status"], string> = { done: "Read", "in-progress": "Reading", ready: "Ready", optional: "Optional", "locked-by-prereqs": "Locked" };

function ItemCard({ entry }: { entry: DiscoverItem }) {
  const { item, status, progressPct, resourceId, recommended } = entry;
  return <li className={`discover-item is-${item.type} is-${status}${recommended ? " is-recommended" : ""}`}>
    <div className="discover-item-head">
      <span className="discover-item-kind">{item.type === "paper" ? <FileText aria-hidden="true" /> : <Lightbulb aria-hidden="true" />}{item.type === "paper" ? "Paper" : "Concept"}</span>
      <span className="discover-item-status">{status === "done" ? <Check aria-hidden="true" /> : status === "locked-by-prereqs" ? <Lock aria-hidden="true" /> : null}{status === "in-progress" ? `${Math.round(progressPct)}% read` : STATUS_LABEL[status]}</span>
    </div>
    {recommended ? <p className="discover-item-next"><Sparkles aria-hidden="true" />Recommended next</p> : null}
    <h4>{item.title}</h4>
    {item.type === "paper" ? <p className="discover-item-byline">{item.authors.slice(0, 3).join(", ")}{item.authors.length > 3 ? " et al." : ""} · {item.year}{item.venue ? ` · ${item.venue}` : ""}</p> : null}
    <p className="discover-item-why">{item.why}</p>
    {entry.waitingOn.length ? <p className="discover-item-locked">First: {entry.waitingOn.join(", ")}</p> : null}
    <div className="discover-item-actions">
      <span className={`discover-difficulty is-${item.difficulty}`}>{item.difficulty}</span>
      <ItemAction item={item} resourceId={resourceId} />
    </div>
  </li>;
}

function ItemAction({ item, resourceId }: { item: CurriculumItem; resourceId: string | null }) {
  if (item.type === "concept") return <Link className="discover-item-link" href={`/app/discover?q=${encodeURIComponent(item.title)}`}>Learn it<ArrowUpRight aria-hidden="true" /></Link>;
  if (resourceId) return <StartStudyButton className="discover-item-link is-primary" resourceId={resourceId} origin="research" label="Study" />;
  return <a className="discover-item-link" href={item.url} target="_blank" rel="noreferrer">arXiv<ArrowUpRight aria-hidden="true" /></a>;
}

/** One path as a map: its modules in order, each step with why it matters, what to focus on and where the learner stands. */
export function ResearchTrack({ data }: { data: ResearchTrackPageData }) {
  const { summary, modules, nextTracks, buildsOn } = data;
  const { track } = summary;
  const next = modules.flatMap((module) => module.items).find((entry) => entry.recommended && entry.item.type === "paper" && entry.resourceId);
  return <main className="research-page discover-page">
    <nav className="discover-crumbs" aria-label="Breadcrumb"><Link href="/app/research/discover">Learning paths</Link><span aria-hidden="true">/</span><span aria-current="page">{track.title}</span></nav>
    <header className="discover-track-header">
      <div>
        <h1>{track.title}</h1>
        <p className="discover-track-audience">{track.audience}</p>
        <TrackMeta summary={summary} />
        <Progress value={summary.progressPct} label={`${track.title} progress`} />
        <small className="discover-progress-label">{summary.progressPct}% of required papers read</small>
        {next?.resourceId ? <StartStudyButton className="discover-cta" resourceId={next.resourceId} origin="research" label={`${summary.started ? "Continue" : "Start"} with ${next.item.title}`} /> : null}
      </div>
      <div className="discover-track-goals">
        <p className="discover-label">You will be able to</p>
        <ul className="discover-outcomes">{track.outcomes.map((outcome) => <li key={outcome}><Check aria-hidden="true" />{outcome}</li>)}</ul>
        {track.assumedKnowledge.length ? <><p className="discover-label">Assumes</p><p className="discover-assumes">{track.assumedKnowledge.join(" · ")}</p></> : null}
        {buildsOn.length ? <><p className="discover-label">Builds on</p><p className="discover-assumes">{buildsOn.map((prior, index) => <span key={prior.id}>{index ? " · " : ""}<Link href={trackHref(prior.id)}>{prior.title}</Link></span>)}</p></> : null}
      </div>
    </header>
    <ol className="discover-modules">
      {modules.map((module, index) => <li key={module.id} className="discover-module">
        <div className="discover-module-heading"><span className="discover-module-number">{index + 1}</span><h3>{module.title}</h3><span>{module.items.filter(({ status }) => status === "done").length}/{module.items.length}</span></div>
        <ul className="discover-items">{module.items.map((entry) => <ItemCard key={entry.item.id} entry={entry} />)}</ul>
      </li>)}
    </ol>
    {nextTracks.length ? <section aria-labelledby="discover-next-title"><div className="discover-section-heading"><h2 id="discover-next-title">Where to go next</h2></div><ul className="discover-next-tracks">{nextTracks.map((nextTrack) => <li key={nextTrack.id}><Link href={trackHref(nextTrack.id)}>{nextTrack.title}<ArrowRight aria-hidden="true" /></Link></li>)}</ul></section> : null}
  </main>;
}
