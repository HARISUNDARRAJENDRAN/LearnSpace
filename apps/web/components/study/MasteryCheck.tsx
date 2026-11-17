"use client";

import type { StudyAnchor } from "@learnspace/shared";
import type { MasteryQuestionView, MasteryView } from "@learnspace/shared/mastery";
import { Check, LoaderCircle, Mic, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LoadingState } from "./LoadingState";
import { type MasteryNext, MasteryResults } from "./MasteryResults";
import { MathText } from "./MathText";
import { PlaceLink, placeOf } from "./place";
import { SessionPanelHeader } from "./SessionPanelHeader";
import { useSpeechInput } from "./useSpeechInput";

const VERDICT = { correct: "Correct", partial: "Partly right", incorrect: "Not quite" } as const;

async function request(url: string, body?: unknown): Promise<MasteryView> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const value = (await response.json().catch(() => null)) as (MasteryView & { error?: { message?: string } }) | null;
  if (!response.ok || !value) throw new Error(value?.error?.message ?? "The check couldn't load right now.");
  return value;
}

const percent = (score: number) => `${Math.round(score * 100)}%`;

/**
 * The hard questions a learner must pass, after watching a video, before the next one unlocks: one at a time, each
 * marked as it is answered, linking back to the moment it comes from. A failed set is replaced by a fresh one.
 */
/** `place` is where the learner is, saved as the resume point when they finish the lesson from here. */
export function MasteryCheck({ sessionId, resourceId, next, place, onGo, onCollapse }: { sessionId: string; resourceId: string; next: MasteryNext; place: StudyAnchor; onGo: (place: StudyAnchor) => void; onCollapse: () => void }) {
  const router = useRouter();
  const base = `/api/v1/study-sessions/${sessionId}/mastery`;
  const [view, setView] = useState<MasteryView | null>(null);
  const [busy, setBusy] = useState<"writing" | "grading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const speech = useSpeechInput((spoken) => setText((current) => (current.trim() ? `${current.trimEnd()} ${spoken}` : spoken)));
  const recording = speech.state === "recording";

  const run = useCallback(async (kind: typeof busy, work: () => Promise<MasteryView>) => {
    setBusy(kind);
    setError(null);
    try {
      const next = await work();
      setView(next);
      return next;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  // Reopens on the first question still unanswered.
  const open = useCallback((next: MasteryView | null) => {
    const questions = next?.check?.questions ?? [];
    const first = questions.findIndex((question) => !question.result);
    setIndex(first < 0 ? questions.length : first);
    setText("");
  }, []);

  useEffect(() => { void run(null, () => request(base)).then(open); }, [base, run, open]);
  // The set is written in the background when the video ends; until its first question lands, check back every couple of seconds.
  const writing = view?.state === "writing";
  useEffect(() => {
    if (!writing) return;
    const timer = window.setInterval(() => void request(base).then((next) => { if (next.state !== "writing") { setView(next); open(next); } }, () => undefined), 2_000);
    return () => window.clearInterval(timer);
  }, [writing, base, open]);
  // The learner answers the first questions while the rest are written into the set; each new one appears as it lands.
  const filling = view?.check?.writing === true;
  useEffect(() => {
    if (!filling) return;
    const timer = window.setInterval(() => void request(base).then(setView, () => undefined), 1_500);
    return () => window.clearInterval(timer);
  }, [filling, base]);

  const start = () => void run("writing", () => request(base, {})).then(open);

  // A scored set is read by its id from here on: passing it moves the session to the next lesson, and its results (and the
  // analysis written for them) stay on screen until the learner continues.
  const scored = view && view.state !== "open" && view.check && view.check.status !== "open" ? view.check : null;
  const scoredId = scored?.id ?? null;
  const analysis = scored?.analysis?.status ?? null;
  const analyse = useCallback(() => {
    if (!scoredId) return;
    void request(`${base}/analysis`, { checkId: scoredId }).then(setView, () => undefined);
  }, [base, scoredId]);
  useEffect(() => { if (scoredId && analysis === null) analyse(); }, [scoredId, analysis, analyse]);
  useEffect(() => {
    if (!scoredId || analysis !== "writing") return;
    const timer = window.setInterval(() => void request(`${base}?check=${scoredId}`).then(setView, () => undefined), 2_500);
    return () => window.clearInterval(timer);
  }, [base, scoredId, analysis]);

  // Continue completes the lesson (which already moved the session on when the pass was scored, so this is then refused as no
  // longer active, harmlessly) and reloads the session on the next lesson; after the last one it goes back to Sessions.
  const [moving, setMoving] = useState(false);
  const proceed = async () => {
    setMoving(true);
    await fetch(`/api/v1/study-sessions/${sessionId}/progress`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceId, progressPct: 100, anchor: place, event: "complete", idempotencyKey: `continue-${scoredId ?? resourceId}` }),
    }).catch(() => null);
    if (next.nextTitle) router.refresh();
    else router.push("/app/sessions");
  };
  const answer = (question: MasteryQuestionView, response: { choice: number } | { text: string }) =>
    void run(question.type === "written" ? "grading" : null, () => request(`${base}/answers`, { checkId: view?.check?.id, questionId: question.id, ...response }));

  const header = (count?: string) => <SessionPanelHeader title="Mastery check" onCollapse={onCollapse}>{count ? <span className="session-quiz-count">{count}</span> : null}</SessionPanelHeader>;
  const shell = (body: React.ReactNode, count?: string) => <div className="session-tool">{header(count)}<div className="session-tool-body" data-lenis-prevent>{body}</div></div>;
  const alert = error ? <p className="session-tool-message is-error" role="alert">{error}</p> : null;

  if (busy === "writing" || writing) return shell(<LoadingState label="Writing hard questions from the transcript" />);
  if (!view) return shell(error ? alert : <LoadingState label="Loading the check" />);
  const pass = percent(view.passScore);
  const check = view.check;

  if (view.state === "unavailable") return shell(<div className="session-tool-empty"><p>This video has no transcript, so it has no mastery check. Finishing it moves you on.</p></div>);
  if (view.state === "locked") return shell(<div className="session-tool-empty"><p>Watch the video to the end to unlock its check: hard questions on the whole lesson. Score {pass} or more to unlock the next video.</p></div>);
  if (view.state === "ready" || !check) {
    return shell(<div className="session-tool-empty">
      <p>Before the next video unlocks, show you&apos;ve mastered this one: 5 to 10 hard questions on the whole lesson, multiple choice and short written answers. You need {pass}.</p>
      <button className="session-primary-button" type="button" onClick={start}>Start the check</button>
      {alert}
    </div>);
  }

  const { questions } = check;
  const question = questions[index];
  if (scored && (!question || index >= questions.length)) {
    return shell(<>
      <MasteryResults check={scored} passScore={view.passScore} next={next} moving={moving} onGo={onGo} onReview={(at) => { setIndex(at); setText(""); }}
        onContinue={() => void proceed()} onRetake={start} onAnalyse={analyse} />
      {alert}
    </>);
  }
  const count = `${Math.min(index + 1, questions.length + (check.writing ? 1 : 0))} / ${questions.length}${check.writing ? "+" : ""}`;
  if (!question) return shell(check.writing || view.state === "open" ? <LoadingState label="Writing the next question" /> : alert, count);

  const result = question.result;
  const chosen = result && "choice" in result.response ? result.response.choice : null;
  const last = index + 1 === questions.length && !check.writing;
  // Reviewing a scored set adds what the analysis made of this answer and where the notes cover it.
  const mistake = scored?.analysis?.status === "ready" ? scored.analysis.mistakes.find((entry) => entry.questionId === question.id) : undefined;
  const section = scored?.notesSections[question.id];
  return shell(<div className="session-quiz-question">
    <p className="session-quiz-prompt"><MathText text={question.question} /></p>
    {question.options ? (
      <ol className="session-quiz-options">
        {question.options.map((option, optionIndex) => {
          const state = !result ? "" : optionIndex === result.answer ? " is-correct" : optionIndex === chosen ? " is-wrong" : "";
          return <li key={option}><button className={`session-quiz-option${state}`} type="button" disabled={Boolean(result) || busy !== null} onClick={() => answer(question, { choice: optionIndex })}><span>{String.fromCharCode(65 + optionIndex)}</span><span className="session-quiz-option-text"><MathText text={option} /></span>{state === " is-correct" ? <Check aria-label="Correct answer" /> : state === " is-wrong" ? <X aria-label="Your answer" /> : null}</button></li>;
        })}
      </ol>
    ) : result ? (
      <blockquote className="mastery-written">{"text" in result.response ? result.response.text : ""}</blockquote>
    ) : (
      <form className="mastery-written-form" onSubmit={(event) => { event.preventDefault(); if (text.trim() && !busy) answer(question, { text: text.trim() }); }}>
        <label className="sr-only" htmlFor="mastery-answer">Your answer</label>
        <textarea id="mastery-answer" value={text} rows={5} maxLength={2_000} placeholder={recording ? "Listening…" : speech.state === "transcribing" ? "Transcribing…" : "Explain in two to four sentences…"} disabled={busy !== null} onChange={(event) => setText(event.target.value)} />
        {speech.progress !== null ? <p className="session-tool-message" role="status">Downloading the voice model, one time only · {Math.round(speech.progress)}%</p> : null}
        {busy === "grading" ? <LoadingState label="Grading your answer" /> : <div className="mastery-written-actions">
          <button className="session-primary-button" type="submit" disabled={!text.trim() || speech.state !== "idle"}>Submit answer</button>
          <button className={`chat-mic${recording ? " is-recording" : ""}`} type="button" aria-label={recording ? "Stop dictating" : "Dictate your answer"} title={recording ? "Stop dictating" : "Dictate (runs on your device)"} aria-pressed={recording} disabled={speech.state === "transcribing"} onClick={() => (recording ? speech.stop() : void speech.start())}>
            {recording ? <span className="chat-eq" aria-hidden="true"><span /><span /><span /></span> : speech.state === "transcribing" ? <LoaderCircle className="chat-spin" aria-hidden="true" /> : <Mic aria-hidden="true" />}
          </button>
        </div>}
        {speech.error ? <p className="session-tool-message is-error" role="alert">{speech.error}</p> : null}
      </form>
    )}
    {alert}
    {result ? (
      <div className="session-quiz-feedback" role="status">
        <strong>{VERDICT[result.verdict]}</strong>
        <p><MathText text={result.feedback} /></p>
        {result.modelAnswer ? <p><b>A full answer:</b> <MathText text={result.modelAnswer} /></p> : null}
        {mistake ? <div className="mastery-mistake"><dl>
          <dt>What happened</dt><dd><MathText text={mistake.observed} /></dd>
          <dt>Likely why <span className="mastery-inferred" title="Inferred from your answer, not certain">inferred</span></dt><dd><MathText text={mistake.likelyCause} /></dd>
          <dt>In plain words</dt><dd><MathText text={mistake.eli5} /></dd>
          <dt>The right reasoning</dt><dd><MathText text={mistake.correctReasoning} /></dd>
        </dl></div> : null}
        {section ? <p className="mastery-notes-link">In your notes: <MathText text={section} /></p> : null}
        <PlaceLink place={placeOf(question.positionMs, question.anchor)} onGo={onGo} />
        <div className="mastery-review-nav">
          {scored ? <button className="session-secondary-button" type="button" onClick={() => setIndex(questions.length)}>Back to results</button> : null}
          <button className="session-primary-button" type="button" onClick={() => { setIndex(index + 1); setText(""); }}>{last ? "See results" : "Next question"}</button>
        </div>
      </div>
    ) : null}
  </div>, count);
}
