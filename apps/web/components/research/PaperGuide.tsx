"use client";

import type { PaperCitationAnchor, ResearchGuide, StudyAnchor } from "@learnspace/shared";
import { FileText } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { LoadingState } from "../study/LoadingState";
import { MathText } from "../study/MathText";
import { SessionPanelHeader } from "../study/SessionPanelHeader";

type GuideView = { status: "pending" | "ready" | "failed"; guide: ResearchGuide | null };
type Explorer = ResearchGuide["explorer"];

const POLL_MS = 5_000;
const LINE_COLORS = ["var(--guide-line-1)", "var(--guide-line-2)", "var(--guide-line-3)", "var(--guide-line-4)"];

/** "0.2", "1.35e-4", "12,400": a value short enough to read at a glance. */
const formatValue = (value: number) => Math.abs(value) >= 1e5 || (value !== 0 && Math.abs(value) < 1e-3) ? value.toExponential(2) : Number(value.toPrecision(4)).toLocaleString();

/** The pages a claim comes from, each opening the paper there. */
function Anchors({ anchors, onGo }: { anchors: PaperCitationAnchor[]; onGo: (place: StudyAnchor) => void }) {
  const pages = [...new Map(anchors.map((anchor) => [anchor.page, anchor])).values()];
  return <span className="guide-anchors">{pages.map((anchor) => <button key={anchor.page} type="button" className="tutor-cite" title={`Read p. ${anchor.page}`} onClick={() => onGo(anchor)}><FileText aria-hidden="true" />p. {anchor.page}</button>)}</span>;
}

/** A question to answer before the answer is shown. */
function Predict({ prompt, answer }: { prompt: string; answer: string }) {
  return <div className="guide-predict">
    <p className="guide-predict-prompt"><strong>Predict.</strong> <MathText text={prompt} /></p>
    <details><summary>Show the answer</summary><p><MathText text={answer} /></p></details>
  </div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="guide-section"><h3>{title}</h3>{children}</section>;
}

/** Sliders over the guide's parameter grid; every value shown was computed by running code in the sandbox. */
function GuideExplorer({ explorer }: { explorer: Explorer }) {
  const [at, setAt] = useState<Record<string, number>>(() => Object.fromEntries(explorer.parameters.map((parameter) => [parameter.id, Math.floor((parameter.values.length - 1) / 2)])));
  const valueOf = (id: string) => { const parameter = explorer.parameters.find((item) => item.id === id); return parameter?.values[at[id] ?? 0]; };
  const rowWhere = (fixed: Record<string, number | undefined>) => explorer.table.find((row) => explorer.parameters.every((parameter) => row.parameters[parameter.id] === fixed[parameter.id]));
  const current = rowWhere(Object.fromEntries(explorer.parameters.map((parameter) => [parameter.id, valueOf(parameter.id)])));
  const chart = explorer.chart;
  const xParameter = chart ? explorer.parameters.find((parameter) => parameter.id === chart.xParameter) : undefined;
  const series = chart && xParameter ? chart.outputs.map((output) => xParameter.values.map((x) => {
    const row = rowWhere(Object.fromEntries(explorer.parameters.map((parameter) => [parameter.id, parameter.id === xParameter.id ? x : valueOf(parameter.id)])));
    return row ? { x, y: row.outputs[output] } : null;
  }).filter((point): point is { x: number; y: number } => point !== null && Number.isFinite(point.y))) : [];
  return <div className="guide-explorer">
    {explorer.parameters.map((parameter) => <label key={parameter.id} className="guide-slider">
      <span><MathText text={parameter.symbol ? `$${parameter.symbol}$` : ""} /> {parameter.label}</span>
      <input type="range" min={0} max={parameter.values.length - 1} step={1} value={at[parameter.id] ?? 0} onChange={(event) => setAt({ ...at, [parameter.id]: Number(event.target.value) })} aria-valuetext={formatValue(parameter.values[at[parameter.id] ?? 0] ?? 0)} />
      <output>{formatValue(parameter.values[at[parameter.id] ?? 0] ?? 0)}</output>
    </label>)}
    <dl className="guide-outputs" aria-live="polite">
      {explorer.outputs.map((output) => <div key={output.id}><dt><MathText text={output.symbol ? `$${output.symbol}$` : ""} /> {output.label}</dt><dd>{current ? formatValue(current.outputs[output.id] ?? Number.NaN) : "–"}</dd></div>)}
    </dl>
    {chart && xParameter && series.some((points) => points.length > 1) ? <GuideChart explorer={explorer} xLabel={xParameter.label} x={valueOf(xParameter.id)} series={series} /> : null}
  </div>;
}

function GuideChart({ explorer, xLabel, x, series }: { explorer: Explorer; xLabel: string; x: number | undefined; series: Array<Array<{ x: number; y: number }>> }) {
  const W = 360, H = 170, PAD = 28, LEFT = 52; // LEFT fits a signed tick like −1.356
  const points = series.flat();
  const [x0, x1] = [Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x))];
  const [y0, y1] = [Math.min(...points.map((p) => p.y)), Math.max(...points.map((p) => p.y))];
  const sx = (value: number) => LEFT + ((value - x0) / (x1 - x0 || 1)) * (W - LEFT - PAD);
  const sy = (value: number) => H - PAD - ((value - y0) / (y1 - y0 || 1)) * (H - PAD * 2);
  const labels = explorer.chart?.outputs.map((id) => explorer.outputs.find((output) => output.id === id)?.label ?? id) ?? [];
  return <figure className="guide-chart">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${labels.join(", ")} as ${xLabel} changes`}>
      <line className="guide-axis" x1={LEFT} y1={H - PAD} x2={W - PAD} y2={H - PAD} />
      <line className="guide-axis" x1={LEFT} y1={PAD} x2={LEFT} y2={H - PAD} />
      <text className="guide-tick" x={LEFT} y={H - 8}>{formatValue(x0)}</text>
      <text className="guide-tick" x={W - PAD} y={H - 8} textAnchor="end">{formatValue(x1)}</text>
      <text className="guide-tick" x={LEFT - 4} y={PAD + 4} textAnchor="end">{formatValue(y1)}</text>
      <text className="guide-tick" x={LEFT - 4} y={H - PAD} textAnchor="end">{formatValue(y0)}</text>
      {x !== undefined ? <line className="guide-marker" x1={sx(x)} y1={PAD} x2={sx(x)} y2={H - PAD} /> : null}
      {series.map((line, index) => <polyline key={labels[index] ?? index} fill="none" stroke={LINE_COLORS[index % LINE_COLORS.length]} strokeWidth={2} points={line.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")} />)}
    </svg>
    <figcaption>{labels.map((label, index) => <span key={label}><i style={{ background: LINE_COLORS[index % LINE_COLORS.length] }} />{label}</span>)}<span className="guide-chart-x">across {xLabel}</span></figcaption>
  </figure>;
}

/** The paper's core mechanism as a hands-on lesson: a question, a worked example, an explorer, edge cases, the link back to the full system and a project. */
export function PaperGuide({ sessionId, onGo, onCollapse }: { sessionId: string; onGo: (place: StudyAnchor) => void; onCollapse: () => void }) {
  const [view, setView] = useState<GuideView | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const load = async () => {
      const response = await fetch(`/api/v1/study-sessions/${sessionId}/guide`, { cache: "no-store" }).catch(() => null);
      if (stopped) return;
      if (!response?.ok) { setError(true); return; }
      const body = await response.json() as GuideView;
      setError(false);
      setView(body);
      if (body.status === "pending") timer = window.setTimeout(() => void load(), POLL_MS);
    };
    void load();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [sessionId, attempt]);
  async function retry() {
    setView(null);
    await fetch(`/api/v1/study-sessions/${sessionId}/guide`, { method: "POST" }).catch(() => null);
    setAttempt((value) => value + 1);
  }

  const shell = (body: ReactNode) => <div className="session-tool"><SessionPanelHeader title="Project guide" onCollapse={onCollapse} /><div className="session-tool-body" data-lenis-prevent>{body}</div></div>;
  if (error) return shell(<div className="session-tool-empty"><p>The guide couldn&apos;t be loaded.</p><button className="session-primary-button" type="button" onClick={() => void retry()}>Try again</button></div>);
  if (!view || view.status === "pending") return shell(<LoadingState label="Building a hands-on guide to the paper's core idea" />);
  if (view.status === "failed" || !view.guide) return shell(<div className="session-tool-empty"><p>No guide could be built and checked for this paper yet.</p><button className="session-primary-button" type="button" onClick={() => void retry()}>Try again</button></div>);

  const guide = view.guide;
  return shell(<article className="paper-guide">
    <header className="guide-head">
      <p className="guide-eyebrow">Project &amp; intuition guide</p>
      <h2>{guide.title}</h2>
      <p className="guide-mechanism"><MathText text={guide.mechanism} /></p>
      <p><MathText text={guide.objective} /></p>
    </header>
    {guide.prerequisites.length ? <Section title="Before you start"><ul className="guide-list">{guide.prerequisites.map((item) => <li key={item.name}><strong><MathText text={item.name} /></strong> <MathText text={item.why} /></li>)}</ul></Section> : null}
    <Section title="Where it sits in the paper"><p><MathText text={guide.relationship.text} /> <Anchors anchors={guide.relationship.anchors} onGo={onGo} /></p></Section>
    <Section title="Start with a question">
      <p><MathText text={guide.motivation.scenario} /> <Anchors anchors={guide.motivation.anchors} onGo={onGo} /></p>
      <Predict prompt={guide.motivation.prediction} answer={guide.motivation.answer} />
    </Section>
    <Section title="Work it through">
      <ol className="guide-steps">{guide.workedExample.steps.map((step, index) => <li key={index}>
        <p><MathText text={step.text} /> <Anchors anchors={step.anchors} onGo={onGo} /></p>
        {step.latex ? <div className="guide-equation"><MathText text={`$$${step.latex}$$`} /></div> : null}
        {step.values ? <p className="guide-values">{Object.entries(step.values).map(([name, value]) => <code key={name}>{name} = {formatValue(value)}</code>)}</p> : null}
      </li>)}</ol>
    </Section>
    {guide.explorer.parameters.length ? <Section title="Explore it"><p className="guide-note">Move the sliders. Every number here was computed by running the guide&apos;s code, not estimated.</p><GuideExplorer explorer={guide.explorer} /></Section> : null}
    <Section title="Edge cases">{guide.edgeCases.map((item, index) => <div key={index} className="guide-case"><p><MathText text={item.setup} /> <Anchors anchors={item.anchors} onGo={onGo} /></p><Predict prompt={item.prediction} answer={item.answer} /></div>)}</Section>
    <Section title="From the toy to the full system">
      <table className="guide-mapping"><thead><tr><th scope="col">In this guide</th><th scope="col">In the paper</th></tr></thead>
        <tbody>{guide.mapping.map((row, index) => <tr key={index}><td><MathText text={row.toy} /></td><td><MathText text={row.fullSystem} /> <Anchors anchors={row.anchors} onGo={onGo} /></td></tr>)}</tbody>
      </table>
    </Section>
    <Section title="What this doesn't capture"><ul className="guide-list">{guide.caveats.map((item, index) => <li key={index}><MathText text={item.text} /> <Anchors anchors={item.anchors} onGo={onGo} /></li>)}</ul></Section>
    <Section title="Your project">
      <ol className="guide-steps">{guide.project.steps.map((step, index) => <li key={index}><p><MathText text={step.text} /> <Anchors anchors={step.anchors} onGo={onGo} /></p></li>)}</ol>
      <h4>What you should see</h4><ul className="guide-list">{guide.project.expectedResults.map((item) => <li key={item}><MathText text={item} /></li>)}</ul>
      <h4>How to check you&apos;re right</h4><p><MathText text={guide.project.validation} /></p>
      {guide.project.misconceptions.length ? <><h4>Common misconceptions</h4><ul className="guide-list">{guide.project.misconceptions.map((item) => <li key={item}><MathText text={item} /></li>)}</ul></> : null}
      {guide.project.furtherExploration.length ? <><h4>Going further</h4><ul className="guide-list">{guide.project.furtherExploration.map((item) => <li key={item}><MathText text={item} /></li>)}</ul></> : null}
      {guide.project.gpuReproductionPlan ? <div className="guide-gpu"><h4>{guide.project.gpuReproductionPlan.label}</h4><p className="guide-note">This needs more compute than LearnSpace&apos;s CPU sandbox; it can&apos;t be reproduced here.</p><ol className="guide-list">{guide.project.gpuReproductionPlan.steps.map((step) => <li key={step}><MathText text={step} /></li>)}</ol></div> : null}
    </Section>
    <Section title="Takeaways"><ul className="guide-list">{guide.takeaways.map((item, index) => <li key={index}><MathText text={item.text} /> <Anchors anchors={item.anchors} onGo={onGo} /></li>)}</ul></Section>
  </article>);
}
