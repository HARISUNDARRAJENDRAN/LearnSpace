"use client";

import type { MasteryQuestionView, MasteryView } from "@learnspace/shared/mastery";
import { Check, LoaderCircle, Mic, Play, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { LoadingState } from "./LoadingState";
import { MathText } from "./MathText";
import { SessionPanelHeader } from "./SessionPanelHeader";
import { formatTime } from "./StudyWorkspace";
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
export function MasteryCheck({ sessionId, onSeek, onCollapse }: { sessionId: string; onSeek: (positionMs: number) => void; onCollapse: () => void }) {
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
  // The set is written in the background when the video ends; until it lands, check back every couple of seconds.
  const writing = view?.state === "writing";
  useEffect(() => {
    if (!writing) return;
    const timer = window.setInterval(() => void request(base).then((next) => { if (next.state !== "writing") { setView(next); open(next); } }, () => undefined), 2_000);
    return () => window.clearInterval(timer);
  }, [writing, base, open]);

  const start = () => void run("writing", () => request(base, {})).then(open);
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
  if (view.state !== "open" && (!question || index >= questions.length)) {
    const passed = view.state === "passed";
    const missed = questions.filter((item) => item.result && item.result.credit < 1);
    return shell(<div className="session-quiz-result" role="status">
      <p className="session-quiz-score">{percent(check.score ?? 0)}</p>
      <p>{passed ? "Mastered. The next video is unlocked." : `You need ${pass} to move on. Review what you missed, then take a fresh set.`}</p>
      {!passed && missed.length > 0 ? <ul className="mastery-review">{missed.map((item) => <li key={item.id}><span><MathText text={item.question} /></span>{item.positionMs === null ? null : <button className="session-link-button" type="button" onClick={() => onSeek(item.positionMs ?? 0)}><Play aria-hidden="true" />Watch at {formatTime(item.positionMs)}</button>}</li>)}</ul> : null}
      <div className="session-quiz-actions">
        <button className="session-secondary-button" type="button" onClick={() => setIndex(0)}>Review answers</button>
        {passed ? <button className="session-primary-button" type="button" onClick={() => router.refresh()}>Continue</button> : <button className="session-primary-button" type="button" onClick={start}>New set of questions</button>}
      </div>
      {alert}
    </div>);
  }
  if (!question) return shell(alert);

  const result = question.result;
  const chosen = result && "choice" in result.response ? result.response.choice : null;
  const last = index + 1 === questions.length;
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
        {question.positionMs === null ? null : <button className="session-link-button" type="button" onClick={() => onSeek(question.positionMs ?? 0)}><Play aria-hidden="true" />Watch at {formatTime(question.positionMs)}</button>}
        <button className="session-primary-button" type="button" onClick={() => { setIndex(index + 1); setText(""); }}>{last ? "See results" : "Next question"}</button>
      </div>
    ) : null}
  </div>, `${Math.min(index + 1, questions.length)} / ${questions.length}`);
}
