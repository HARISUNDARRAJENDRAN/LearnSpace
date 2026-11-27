"use client";

import type { StudyAnchor } from "@learnspace/shared";
import { type MasteryCheckView, masteryBand } from "@learnspace/shared/mastery";
import { ArrowRight, ArrowUpRight, BookOpen, Check, ChevronRight, Lightbulb, LoaderCircle, RotateCcw, Sparkles, Target, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { DIAL, dialStripes, HEAT, ringSlice } from "../ui/stripes";
import { MathText } from "./MathText";
import { PlaceLink, placeOf } from "./place";

/** Where passing this lesson leads: the course's next lesson, or the end of the course (or of a single lesson). */
export type MasteryNext = { course: { completed: number; total: number } | null; nextTitle: string | null };

const BAND = {
  excellent: { label: "Excellent", line: "You've mastered this", mood: "🎉" },
  mastered: { label: "Mastered", line: "You've mastered this", mood: "🙂" },
  close: { label: "Almost there", line: "A little more and you're through.", mood: "🙂" },
  review: { label: "Needs review", line: "A few ideas need another look.", mood: "💪" },
} as const;
/** A course is made of lessons; a paper set of papers. */
const UNIT = { video: { one: "lesson", many: "lessons", whole: "Course" }, paper: { one: "paper", many: "papers", whole: "Set" } } as const;
const percent = (value: number) => `${Math.round(value * 100)}%`;

const STRIPES = dialStripes(HEAT);

function ScoreDial({ score, passScore, children }: { score: number; passScore: number; children: React.ReactNode }) {
  const edges = useMemo(() => [...new Set([0, Math.max(0, passScore - 0.2), passScore, Math.max(passScore, 0.9), 1])].filter((edge) => edge >= 0 && edge <= 1), [passScore]);
  const gap = 0.012;
  const bands = edges.slice(1).map((edge, index) => [(edges[index] ?? 0) + (index ? gap : 0), edge - (index < edges.length - 2 ? gap : 0)] as const).filter(([from, to]) => to - from > 0.02);
  const clip = `mastery-dial-${useId().replace(/:/g, "")}`;
  return <div className="mastery-dial" role="img" aria-label={`Score ${percent(score)}; ${percent(passScore)} passes`}>
    <svg viewBox="-26 0 392 196" aria-hidden="true">
      <defs><clipPath id={clip}>{bands.map(([from, to]) => <path key={from} d={ringSlice(from, to)} />)}</clipPath></defs>
      <g clipPath={`url(#${clip})`}>
        {STRIPES.map((stripe, index) => <path key={stripe.d} d={stripe.d} stroke={stripe.color} className={stripe.t > score + 0.004 ? "is-ahead" : undefined} style={{ "--s": index } as React.CSSProperties} />)}
      </g>
      {edges.map((edge) => {
        const theta = Math.PI * (1 - edge);
        const cos = Math.cos(theta);
        const radius = DIAL.outer + (Math.abs(cos) > 0.95 ? 6 : 14);
        const x = DIAL.cx + radius * cos;
        const y = DIAL.cy - radius * Math.sin(theta) + (Math.abs(cos) > 0.95 ? 22 : 4);
        return <text key={edge} x={x} y={y} textAnchor={cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle"}>{percent(edge)}</text>;
      })}
    </svg>
    <div className="mastery-dial-center">{children}</div>
  </div>;
}

type Props = {
  check: MasteryCheckView;
  passScore: number;
  next: MasteryNext;
  moving: boolean;
  onGo: (place: StudyAnchor) => void;
  onReview: (index: number) => void;
  onContinue: () => void;
  onRetake: () => void;
  onAnalyse: () => void;
  material: "video" | "paper";
  folder?: boolean;
};

/**
 * What a scored set says: the score on a dial, the answers and concepts behind it, progress over attempts and the course,
 * where to revise, and a learning analysis written from the learner's own answers, which fills in when it is ready.
 */
export function MasteryResults({ check, passScore, next, moving, onGo, onReview, onContinue, onRetake, onAnalyse, material, folder = false }: Props) {
  const unit = UNIT[material];
  const score = check.score ?? 0;
  const passed = check.status === "passed";
  const band = masteryBand(score, passScore);
  const bandLine = band === "excellent" || band === "mastered" ? `${BAND[band].line} ${unit.one}.` : BAND[band].line;
  const questions = check.questions;
  const credit = (index: number) => questions[index]?.result?.credit ?? 0;
  const correct = questions.filter((_, index) => credit(index) === 1).length;
  const partial = questions.filter((_, index) => credit(index) === 0.5).length;
  const missed = questions.length - correct - partial;
  const missedQuestions = questions.map((question, index) => ({ question, index })).filter(({ index }) => credit(index) < 1);

  // Concepts only as the questions name them; a set written before they did reads question by question instead.
  const concepts = [...questions.reduce((map, question, index) => {
    if (!question.concept) return map;
    const entry = map.get(question.concept) ?? { earned: 0, total: 0 };
    map.set(question.concept, { earned: entry.earned + credit(index), total: entry.total + 1 });
    return map;
  }, new Map<string, { earned: number; total: number }>())].map(([name, value]) => ({ name, share: value.earned / value.total, total: value.total })).sort((a, b) => a.share - b.share);

  // Every attempt on this lesson, oldest first; the tabs switch the dial between the latest few.
  const attempts = [...check.earlierScores, score];
  const [shown, setShown] = useState(attempts.length - 1);
  const shownScore = attempts[shown] ?? score;
  const shownPrevious = shown > 0 ? attempts[shown - 1] : undefined;
  const shownChange = shownPrevious === undefined ? null : Math.round((shownScore - shownPrevious) * 100);
  const previous = check.earlierScores.at(-1);
  const change = previous === undefined ? null : Math.round((score - previous) * 100);
  const course = next.course ? { completed: Math.min(next.course.total, next.course.completed), total: next.course.total } : null;
  const analysis = check.analysis;
  const practice = analysis?.status === "ready" ? analysis.practice : [];
  const finished = passed && !next.nextTitle;
  const firstWith = (test: (value: number) => boolean) => questions.findIndex((_, index) => test(credit(index)));
  const tabs = attempts.map((value, index) => ({ value, index })).slice(-3);
  const trend = (points: number) => `${points >= 0 ? "▲" : "▼"} ${points >= 0 ? "+" : ""}${points} pts`;

  const tiles = [
    { key: "correct", title: "Correct", value: correct, chip: `of ${questions.length}`, note: "Questions you answered fully right", review: firstWith((value) => value === 1) },
    { key: "partial", title: "Partly right", value: partial, chip: "Half credit", note: "The right idea with a step missing", review: firstWith((value) => value === 0.5) },
    { key: "missed", title: "Missed", value: missed, chip: missed ? "Revise" : "None", note: "Ideas worth another look", review: firstWith((value) => value === 0) },
    { key: change === null ? "first" : change >= 0 ? "up" : "down", title: "Attempt", value: attempts.length, chip: change === null ? "First try" : trend(change), note: previous === undefined ? `Your first set on this ${unit.one}` : `From ${percent(previous)} last time`, review: -1 },
  ];

  return <div className="mastery-results">
    <section className="mastery-hero" aria-labelledby="mastery-hero-title">
      <header>
        <h3 id="mastery-hero-title" className={`mastery-band is-${band}`}>{BAND[band].label}</h3>
        <p>Here is your mastery score <span aria-hidden="true">{BAND[band].mood}</span></p>
      </header>
      {tabs.length > 1 ? <div className="mastery-tabs" role="tablist" aria-label="Attempts">
        {tabs.map(({ index }) => <button key={index} type="button" role="tab" aria-selected={index === shown} onClick={() => setShown(index)}>
          {index === attempts.length - 1 ? "Latest" : `Attempt ${index + 1}`}
        </button>)}
      </div> : null}
      <ScoreDial score={shownScore} passScore={passScore}>
        <span className={`mastery-trend${shownChange !== null && shownChange < 0 ? " is-down" : ""}`}>
          {shownChange === null ? `${percent(passScore)} to pass` : trend(shownChange)}
        </span>
        <p className="mastery-score"><strong>{percent(shownScore)}</strong><span>on {questions.length} questions</span></p>
      </ScoreDial>
      {folder && passed ? <button className="session-link-button" type="button" onClick={onRetake}>Take another check</button> : null}
      {passed ? <button className="mastery-cta" type="button" disabled={moving} onClick={onContinue}>
        {moving ? <LoaderCircle className="chat-spin" aria-hidden="true" /> : null}{folder ? "Back to canvas" : finished ? "Back to Sessions" : "Continue learning"}
      </button> : <button className="mastery-cta" type="button" onClick={onRetake}><RotateCcw aria-hidden="true" />New set of questions</button>}
      <p className="mastery-verdict">
        {folder ? `Folder check ${passed ? "passed" : "complete"}. ${percent(passScore)} to pass.` : passed ? finished ? next.course ? `${unit.whole} complete. Every ${unit.one} is mastered.` : `${unit.one[0]!.toUpperCase()}${unit.one.slice(1)} mastered.` : `${bandLine} The next ${unit.one} is unlocked.` : `${bandLine} You need ${percent(passScore)} to unlock the next ${unit.one}.`}
      </p>
      {passed && next.nextTitle ? <p className="mastery-next"><ArrowRight aria-hidden="true" /><span>Up next: <MathText text={next.nextTitle} /></span></p> : null}
    </section>

    <div className="mastery-tiles">
      {tiles.map((tile, order) => <article key={tile.title} className={`mastery-tile is-${tile.key}`} style={{ "--i": order } as React.CSSProperties}>
        <header>
          <h3>{tile.title}</h3>
          {tile.review >= 0 ? <button className="mastery-round" type="button" aria-label={`Open the first ${tile.title.toLowerCase()} question`} onClick={() => onReview(tile.review)}><ArrowUpRight aria-hidden="true" /></button> : null}
        </header>
        <p className="mastery-tile-value"><strong>{tile.value}</strong><span className="mastery-chip">{tile.chip}</span></p>
        <p className="mastery-tile-note">{tile.note}</p>
      </article>)}
      {course ? <article className="mastery-tile is-course" style={{ "--i": 4 } as React.CSSProperties}>
        <header><h3>Course progress</h3></header>
        <p className="mastery-tile-value"><strong>{course.completed}</strong><span className="mastery-chip">of {course.total} {unit.many}</span></p>
        <span className="mastery-bar" aria-hidden="true"><i style={{ width: `${(course.completed / Math.max(1, course.total)) * 100}%` }} /></span>
      </article> : null}
    </div>

    <div className="mastery-cards">
      {concepts.length ? <article className="mastery-card" style={{ "--i": 2 } as React.CSSProperties}>
        <header><h3>Concept mastery</h3><span className="mastery-round" aria-hidden="true"><Target /></span></header>
        <ul className="mastery-concepts">
          {concepts.map((concept) => {
            const level = concept.share >= 1 ? "strong" : concept.share >= 0.5 ? "shaky" : "weak";
            return <li key={concept.name} className={`is-${level}`}>
              <span className="mastery-concept-name"><MathText text={concept.name} /><small>{concept.total} {concept.total === 1 ? "question" : "questions"}</small></span>
              <span className="mastery-bar" aria-hidden="true"><i style={{ width: `${Math.max(6, concept.share * 100)}%` }} /></span>
              <span className="mastery-chip">{level === "strong" ? "Strong" : level === "shaky" ? "Shaky" : "Weak"}</span>
            </li>;
          })}
        </ul>
      </article> : null}

      {missedQuestions.length ? <article className="mastery-card" style={{ "--i": 3 } as React.CSSProperties}>
        <header><h3>Revise these moments</h3><span className="mastery-round" aria-hidden="true"><BookOpen /></span></header>
        <ul className="mastery-revise">
          {missedQuestions.map(({ question, index }) => <li key={question.id}>
            <button className="mastery-revise-question" type="button" onClick={() => onReview(index)}>
              <span className={`mastery-dot ${credit(index) === 0.5 ? "is-partial" : "is-missed"}`} aria-hidden="true" />
              <span><small>Question {index + 1}{credit(index) === 0.5 ? " · partly right" : " · missed"}{question.concept ? ` · ${question.concept}` : ""}</small><MathText text={question.question} /></span>
              <span className="mastery-round" aria-hidden="true"><ArrowUpRight /></span>
            </button>
            <div className="mastery-revise-links">
              <PlaceLink place={placeOf(question.positionMs, question.anchor)} onGo={onGo} />
              {check.notesSections[question.id] ? <span className="mastery-notes-link">In your notes: <MathText text={check.notesSections[question.id] ?? ""} /></span> : null}
            </div>
          </li>)}
        </ul>
      </article> : null}
    </div>

    <section className="mastery-analysis" aria-labelledby="mastery-analysis-title" aria-busy={analysis?.status === "writing"}>
      <header><h3 id="mastery-analysis-title">Your learning analysis</h3><span className="mastery-round" aria-hidden="true"><Sparkles /></span></header>
      {!analysis || analysis.status === "writing" ? <div className="mastery-analysis-loading" role="status">
        <p>Reading your answers to see what clicked and what didn&apos;t…</p>
        <span /><span /><span />
      </div> : analysis.status === "failed" ? <p className="session-tool-message">The analysis couldn&apos;t be written just now. <button className="session-link-button" type="button" onClick={onAnalyse}>Try again</button></p> : <>
        <p className="mastery-summary"><MathText text={analysis.summary} /></p>
        {analysis.strengths.length ? <div className="mastery-block is-strengths">
          <h4>What you understood</h4>
          <ul>{analysis.strengths.map((item) => <li key={item}><Check aria-hidden="true" /><span><MathText text={item} /></span></li>)}</ul>
        </div> : null}
        {analysis.mistakes.length ? <div className="mastery-block is-mistakes">
          <h4>Where you struggled</h4>
          {analysis.mistakes.map((mistake) => {
            const index = questions.findIndex((question) => question.id === mistake.questionId);
            const question = questions[index];
            return <article key={mistake.questionId} className="mastery-mistake">
              <header>
                <X aria-hidden="true" />
                <span>Question {index + 1}{question?.concept ? ` · ${question.concept}` : ""}</span>
                <button className="session-link-button" type="button" onClick={() => onReview(index)}>Review<ChevronRight aria-hidden="true" /></button>
              </header>
              <dl>
                <dt>What happened</dt><dd><MathText text={mistake.observed} /></dd>
                <dt>Likely why <span className="mastery-inferred" title="Inferred from your answer, not certain">inferred</span></dt><dd><MathText text={mistake.likelyCause} /></dd>
                <dt>In plain words</dt><dd><MathText text={mistake.eli5} /></dd>
                <dt>The right reasoning</dt><dd><MathText text={mistake.correctReasoning} /></dd>
              </dl>
            </article>;
          })}
        </div> : null}
        {analysis.improvements.length ? <div className="mastery-block is-improve">
          <h4>How to improve</h4>
          <ol>{analysis.improvements.map((item) => <li key={item.concept + item.gap}>
            <strong><MathText text={item.concept} /></strong>
            <span><MathText text={item.gap} /></span>
            <span className="mastery-action"><Lightbulb aria-hidden="true" /><MathText text={item.action} /></span>
          </li>)}</ol>
        </div> : null}
        {practice.length ? <div className="mastery-block is-practice" id="mastery-practice">
          <h4>{missed + partial ? "Practice your weak spots" : "Go a step further"}</h4>
          {practice.map((item, index) => <details key={item.question} className="mastery-practice">
            <summary><span>{index + 1}</span><span><small>{item.concept}</small><MathText text={item.question} /></span></summary>
            <p><MathText text={item.answer} /></p>
          </details>)}
        </div> : null}
      </>}
    </section>

    {/* The secondary ways back into the questions stay in reach at the foot of the panel. */}
    <footer className="mastery-actions">
      <button className="mastery-pill" type="button" onClick={() => onReview(0)}>Review answers</button>
      {practice.length ? <button className="mastery-pill is-ghost" type="button" onClick={() => document.getElementById("mastery-practice")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{missed + partial ? "Practice weak areas" : "Try practice questions"}</button> : null}
    </footer>
  </div>;
}
