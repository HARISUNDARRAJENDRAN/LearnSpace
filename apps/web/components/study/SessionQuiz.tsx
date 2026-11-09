"use client";

import type { StudyQuizQuestion, StudyQuizResponse } from "@learnspace/shared";
import { Check, Play, X } from "lucide-react";
import { useState } from "react";
import { postStudyAction, StudyToolUnavailableError } from "./session-api";
import { SessionPanelHeader } from "./SessionPanelHeader";
import { formatTime } from "./StudyWorkspace";

type QuizState = { status: "idle" | "loading" | "unavailable" | "error" } | { status: "ready"; questions: StudyQuizQuestion[] };

export function SessionQuiz({ sessionId, onSeek, onCollapse }: { sessionId: string; onSeek: (positionMs: number) => void; onCollapse: () => void }) {
  const [quiz, setQuiz] = useState<QuizState>({ status: "idle" });
  const [answers, setAnswers] = useState<number[]>([]);
  const [index, setIndex] = useState(0);

  async function generate() {
    setQuiz({ status: "loading" });
    try {
      const value = await postStudyAction<StudyQuizResponse>(sessionId, "quiz");
      setQuiz(value.questions.length > 0 ? { status: "ready", questions: value.questions } : { status: "unavailable" });
      setAnswers([]);
      setIndex(0);
    } catch (error) {
      setQuiz({ status: error instanceof StudyToolUnavailableError ? "unavailable" : "error" });
    }
  }

  if (quiz.status !== "ready") {
    return (
      <div className="session-tool">
        <SessionPanelHeader title="Quiz" onCollapse={onCollapse} />
        <div className="session-tool-body" data-lenis-prevent>
          <div className="session-tool-empty">
            <p>Check what stuck with a few questions drawn from this video. Each answer links back to the moment it comes from.</p>
            <button className="session-primary-button" type="button" disabled={quiz.status === "loading"} onClick={() => void generate()}>{quiz.status === "loading" ? "Writing questions…" : "Generate quiz"}</button>
            {quiz.status === "unavailable" ? <p className="session-tool-message" role="status">Quizzes aren&apos;t available for sessions yet.</p> : null}
            {quiz.status === "error" ? <p className="session-tool-message is-error" role="alert">The quiz could not be written right now.</p> : null}
          </div>
        </div>
      </div>
    );
  }

  const { questions } = quiz;
  const finished = index >= questions.length;
  const score = answers.filter((answer, position) => answer === questions[position]?.answerIndex).length;
  const question = questions[index];
  const chosen = answers[index];

  return (
    <div className="session-tool">
      <SessionPanelHeader title="Quiz" onCollapse={onCollapse}>{finished ? null : <span className="session-quiz-count">{index + 1} / {questions.length}</span>}</SessionPanelHeader>
      <div className="session-tool-body" data-lenis-prevent>
        {finished || !question ? (
          <div className="session-quiz-result">
            <p className="session-quiz-score">{score} / {questions.length}</p>
            <p>{score === questions.length ? "Every answer right." : "Review the ones you missed, then try again."}</p>
            <div className="session-quiz-actions"><button className="session-secondary-button" type="button" onClick={() => { setAnswers([]); setIndex(0); }}>Try again</button><button className="session-primary-button" type="button" onClick={() => void generate()}>New quiz</button></div>
          </div>
        ) : (
          <div className="session-quiz-question">
            <p className="session-quiz-prompt">{question.prompt}</p>
            <ol className="session-quiz-options">
              {question.options.map((option, optionIndex) => {
                const state = chosen === undefined ? "" : optionIndex === question.answerIndex ? " is-correct" : optionIndex === chosen ? " is-wrong" : "";
                return <li key={option}><button className={`session-quiz-option${state}`} type="button" disabled={chosen !== undefined} onClick={() => setAnswers((current) => { const next = [...current]; next[index] = optionIndex; return next; })}><span>{String.fromCharCode(65 + optionIndex)}</span>{option}{state === " is-correct" ? <Check aria-label="Correct answer" /> : state === " is-wrong" ? <X aria-label="Your answer" /> : null}</button></li>;
              })}
            </ol>
            {chosen !== undefined ? (
              <div className="session-quiz-feedback" role="status">
                <strong>{chosen === question.answerIndex ? "Correct" : "Not quite"}</strong>
                {question.explanation ? <p>{question.explanation}</p> : null}
                {question.anchor?.kind === "video" ? <button className="session-link-button" type="button" onClick={() => onSeek(question.anchor?.kind === "video" ? question.anchor.positionMs : 0)}><Play aria-hidden="true" />Watch at {formatTime(question.anchor.positionMs)}</button> : null}
                <button className="session-primary-button" type="button" onClick={() => setIndex(index + 1)}>{index + 1 === questions.length ? "See results" : "Next question"}</button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
