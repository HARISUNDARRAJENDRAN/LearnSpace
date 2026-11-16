"use client";

import {
  CODING_CONCEPTS, CODING_LANGUAGES, codingLanguageLabels, type CodingAttemptView, type CodingConcept, type CodingLanguage, type CodingStateView, type RunResultView, type SubmissionView,
} from "@learnspace/shared/coding";
import Editor, { type OnMount } from "@monaco-editor/react";
import { ArrowLeft, Check, CirclePlay, CloudUpload, Expand, Lightbulb, Lock, RotateCcw, Send, Shrink, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { codingApi, CodingRequestError, type RunResponse } from "./api";
import { Args, caseText, formatValue, Inline, Prose } from "./text";
import { useFocusActivity } from "./useFocusActivity";

const monacoLanguage: Record<CodingLanguage, string> = { python: "python", javascript: "javascript", typescript: "typescript", java: "java", cpp: "cpp" };
const verdictLabel: Record<SubmissionView["verdict"], string> = {
  accepted: "Accepted", accepted_slow: "Correct, but too slow", wrong_answer: "Wrong Answer", runtime_error: "Runtime Error", time_limit: "Time Limit Exceeded",
  memory_limit: "Memory Limit Exceeded", output_limit: "Output Limit Exceeded", compile_error: "Compile Error",
};
const runLabel: Record<RunResultView["verdict"], string> = { ran: "Finished", compile_error: "Compile Error", time_limit: "Time Limit Exceeded", memory_limit: "Memory Limit Exceeded", output_limit: "Output Limit Exceeded", runtime_error: "Runtime Error" };
const outcomeText: Record<NonNullable<CodingAttemptView["outcome"]>, string> = {
  advance: "Concept confirmed. On to the next one.",
  transfer: "Solved with help, so the next problem practises the same idea in a new form, on your own.",
  reinforce: "One more problem on this idea, a step easier, to make it stick.",
  review_later: "This one goes on your review list; it will come back in a few days.",
};
const DRAFT_SAVE_MS = 1_200;
const POLL_MS = 4_000;

type Pending = null | "run" | "submit" | "hint" | "reply" | "start" | "reveal" | "skip" | "decline";

/**
 * LeetCode-style practice on the lesson: the problem, an editor with a console, and a tutor. Grading happens in the runner;
 * this only shows what it reports. The lesson stays mounted (paused) underneath, so closing returns straight to it.
 */
export function CodingWorkspace({ sessionId, onClose, onSeek }: { sessionId: string; onClose: () => void; onSeek: (positionMs: number) => void }) {
  const [state, setState] = useState<CodingStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const attempt = state?.attempt ?? null;
  const open = attempt !== null && attempt.completedAt === null;

  const call = useCallback(async <T,>(kind: Pending, work: () => Promise<T>): Promise<T | null> => {
    setPending(kind);
    setError(null);
    try {
      return await work();
    } catch (failure) {
      setError(failure instanceof CodingRequestError ? failure.message : "Something went wrong. Try again.");
      return null;
    } finally {
      setPending(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    codingApi(sessionId, "").then((next) => { if (!cancelled) setState(next); }, (failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Couldn't load practice."); });
    return () => { cancelled = true; };
  }, [sessionId]);

  // While a problem is being written, or the lesson classified, ask again until it's there.
  const waiting = state?.preparing.status === "preparing" || state?.profile.status === "classifying" || state?.profile.status === "waiting_transcript";
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => {
      const path = state?.preparing.status === "preparing" ? codingApi(sessionId, "", { body: {} }) : codingApi(sessionId, "");
      path.then(setState, () => undefined);
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [waiting, state, sessionId]);

  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const toggleFocus = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void rootRef.current?.requestFullscreen().catch(() => undefined);
  };
  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    onClose();
  };

  return (
    <div className="coding-workspace" ref={rootRef} role="dialog" aria-modal="true" aria-label="Coding practice">
      <header className="coding-bar">
        <button className="coding-ghost" type="button" onClick={close}><ArrowLeft aria-hidden="true" /><span>Back to lesson</span></button>
        <div className="coding-bar-title">{attempt ? <><strong>{attempt.problem.title}</strong><span className={`coding-difficulty is-${attempt.problem.difficulty}`}>{attempt.problem.difficulty}</span></> : <strong>Code practice</strong>}</div>
        <div className="coding-bar-actions">
          {attempt ? <span className="coding-focus-note" title="A browser can't lock you in: time away is noted, and solutions you paste in count as assisted.">{fullscreen ? "Focus mode" : "Focus mode off"}{attempt.focus.interruptions ? ` · left ${attempt.focus.interruptions}×` : ""}</span> : null}
          <button className="coding-ghost" type="button" aria-pressed={fullscreen} onClick={toggleFocus} title={fullscreen ? "Leave focus mode" : "Focus mode: full screen, nothing else on it"}>{fullscreen ? <Shrink aria-hidden="true" /> : <Expand aria-hidden="true" />}<span>{fullscreen ? "Exit focus" : "Focus"}</span></button>
        </div>
      </header>
      {error ? <div className="coding-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss" onClick={() => setError(null)}><X aria-hidden="true" /></button></div> : null}
      {!state ? <div className="coding-empty"><span className="coding-spinner" aria-hidden="true" />Loading practice...</div>
        : attempt ? <AttemptWorkspace key={attempt.id} sessionId={sessionId} state={state} attempt={attempt} open={open} pending={pending} call={call} setState={setState} onSeek={(ms) => { close(); onSeek(ms); }} />
        : <Intro state={state} pending={pending} onStart={(concept, retry) => void call("start", async () => setState(await codingApi(sessionId, "", { body: { ...(concept ? { concept } : {}), ...(retry ? { retry: true } : {}) } })))} />}
    </div>
  );
}

function Intro({ state, pending, onStart }: { state: CodingStateView; pending: Pending; onStart: (concept?: CodingConcept, retry?: boolean) => void }) {
  const { profile, preparing } = state;
  const [concept, setConcept] = useState<CodingConcept | "">("");
  if (preparing.status === "preparing") return <div className="coding-empty"><span className="coding-spinner" aria-hidden="true" /><div><strong>Preparing your problem</strong><p>{preparing.message} Every problem is run against its own reference solutions before you see it, which takes up to a minute.</p></div></div>;
  if (profile.status === "classifying" || profile.status === "waiting_transcript") return <div className="coding-empty"><span className="coding-spinner" aria-hidden="true" /><div><strong>Reading the lesson</strong><p>{profile.status === "waiting_transcript" ? "Practice is chosen from the lesson's transcript, which is still being prepared." : "Working out what this lesson teaches..."}</p></div></div>;
  const concepts = profile.concepts;
  return (
    <div className="coding-intro">
      <h2>Practise what this lesson teaches</h2>
      {preparing.status === "failed" ? <p className="coding-warning">{preparing.message} <button type="button" className="coding-link" onClick={() => onStart(concept || undefined, true)}>Try again</button></p> : null}
      {concepts.length ? (
        <ol className="coding-concepts">
          {concepts.map((item, index) => {
            const mastery = state.mastery.find((entry) => entry.concept === item.concept);
            return <li key={item.concept}><span className="coding-step">{index + 1}</span><div><strong>{item.label}</strong><p>{item.focus}</p></div>{mastery && mastery.status !== "new" ? <span className={`coding-mastery is-${mastery.status}`}>{mastery.status}</span> : null}</li>;
          })}
        </ol>
      ) : <p>{profile.status === "unavailable" ? "This lesson has no transcript, so practice can't be matched to it, but you can still pick a topic." : "This lesson doesn't look like a coding lesson. Pick a topic to practise anyway."}</p>}
      {!concepts.length ? (
        <label className="coding-field"><span>Topic</span><select value={concept} onChange={(event) => setConcept(event.target.value as CodingConcept)}><option value="">Choose a topic</option>{Object.entries(CODING_CONCEPTS).map(([slug, label]) => <option key={slug} value={slug}>{label}</option>)}</select></label>
      ) : null}
      <p className="coding-rules">Problems are original and checked by running them. Hints are there when you're stuck; each one lowers what the problem can earn. Solve one on your own to move on; with help, you'll get a changed problem on the same idea.</p>
      <button className="coding-primary" type="button" disabled={pending === "start" || (!concepts.length && !concept)} onClick={() => onStart(concept || undefined, preparing.status === "failed")}>{pending === "start" ? "Starting..." : "Start practice"}</button>
    </div>
  );
}

type Call = <T>(kind: Pending, work: () => Promise<T>) => Promise<T | null>;

function AttemptWorkspace({ sessionId, state, attempt, open, pending, call, setState, onSeek }: { sessionId: string; state: CodingStateView; attempt: CodingAttemptView; open: boolean; pending: Pending; call: Call; setState: (state: CodingStateView) => void; onSeek: (ms: number) => void }) {
  const { problem } = attempt;
  const [language, setLanguage] = useState<CodingLanguage>(attempt.language);
  const codeRef = useRef<string>(attempt.drafts[attempt.language] ?? problem.starter[attempt.language]);
  const [editorKey, setEditorKey] = useState(0);
  const [tab, setTab] = useState<"description" | "submissions" | "solution">(attempt.completedAt ? "solution" : "description");
  const [consoleTab, setConsoleTab] = useState<"testcase" | "result">("testcase");
  const [custom, setCustom] = useState<string[]>([]);
  const [run, setRun] = useState<RunResponse["run"] | null>(null);
  const [shown, setShown] = useState<"run" | "submit">("run");
  const focus = useFocusActivity(sessionId, open ? attempt.id : null, setState);
  const saveTimer = useRef<number | null>(null);

  const saveDraft = useCallback((code: string, lang: CodingLanguage) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void codingApi(sessionId, "/draft", { method: "PUT", body: { attemptId: attempt.id, language: lang, code } }).catch(() => undefined); }, DRAFT_SAVE_MS);
  }, [attempt.id, sessionId]);
  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  const switchLanguage = (next: CodingLanguage) => {
    attempt.drafts[language] = codeRef.current;
    setLanguage(next);
    codeRef.current = attempt.drafts[next] ?? problem.starter[next];
    setEditorKey((value) => value + 1);
    if (open) saveDraft(codeRef.current, next);
  };
  const reset = () => {
    codeRef.current = problem.starter[language];
    setEditorKey((value) => value + 1);
    if (open) saveDraft(codeRef.current, language);
  };

  const mount: OnMount = (editor) => {
    editor.onDidPaste((event) => focus.pastedText(editor.getModel()?.getValueInRange(event.range) ?? ""));
    editor.onKeyDown((event) => {
      focus.touch();
      if ((event.ctrlKey || event.metaKey) && (event.code === "KeyC" || event.code === "KeyX")) {
        const selection = editor.getSelection();
        if (selection) focus.copiedText(editor.getModel()?.getValueInRange(selection) ?? "");
      }
    });
  };

  const body = () => ({ attemptId: attempt.id, language, code: codeRef.current });
  const runCode = () => void call("run", async () => {
    focus.touch();
    const result = await codingApi<RunResponse>(sessionId, "/run", { body: { ...body(), custom } });
    setRun(result.run);
    setState(result.state);
    setShown("run");
    setConsoleTab("result");
  });
  const submit = () => void call("submit", async () => {
    focus.touch();
    setState(await codingApi(sessionId, "/submit", { body: body() }));
    setShown("submit");
    setConsoleTab("result");
  });
  const latest = attempt.submissions[0] ?? null;

  // Ctrl/Cmd+Enter runs, with Shift submits, as on LeetCode.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter" || pending) return;
      event.preventDefault();
      if (event.shiftKey) submit(); else runCode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="coding-layout">
      <section className="coding-problem" aria-label="Problem">
        <div className="coding-tabs" role="tablist">
          {(["description", "submissions", "solution"] as const).map((name) => <button key={name} role="tab" type="button" aria-selected={tab === name} onClick={() => setTab(name)}>{name === "solution" && !attempt.completedAt ? <Lock aria-hidden="true" /> : null}{name[0]!.toUpperCase() + name.slice(1)}</button>)}
        </div>
        <div className="coding-scroll">
          {tab === "description" ? <Description attempt={attempt} onSeek={onSeek} /> : null}
          {tab === "submissions" ? <Submissions attempt={attempt} /> : null}
          {tab === "solution" ? <Solution attempt={attempt} pending={pending} onReveal={() => void call("reveal", async () => setState(await codingApi(sessionId, "/reveal", { body: { attemptId: attempt.id } })))} /> : null}
        </div>
      </section>
      <section className="coding-main" aria-label="Code">
        <div className="coding-editor-bar">
          <label className="sr-only" htmlFor="coding-language">Language</label>
          <select id="coding-language" value={language} onChange={(event) => switchLanguage(event.target.value as CodingLanguage)}>{CODING_LANGUAGES.map((item) => <option key={item} value={item}>{codingLanguageLabels[item]}</option>)}</select>
          <button className="coding-ghost" type="button" onClick={reset} title="Reset to the starter code"><RotateCcw aria-hidden="true" /></button>
          <span className="coding-spacer" />
          {open ? <>
            <button className="coding-run" type="button" disabled={pending !== null} onClick={runCode} title="Run on the examples and your own cases (Ctrl+Enter)"><CirclePlay aria-hidden="true" />{pending === "run" ? "Running..." : "Run"}</button>
            <button className="coding-submit" type="button" disabled={pending !== null} onClick={submit} title="Grade on every hidden test (Ctrl+Shift+Enter)"><CloudUpload aria-hidden="true" />{pending === "submit" ? "Judging..." : "Submit"}</button>
          </> : null}
        </div>
        <div className="coding-editor">
          <Editor key={`${editorKey}-${language}`} language={monacoLanguage[language]} defaultValue={codeRef.current} onMount={mount}
            onChange={(value) => { codeRef.current = value ?? ""; focus.edited(); if (open) saveDraft(codeRef.current, language); }}
            loading={<span className="coding-muted">Loading editor...</span>}
            options={{
              automaticLayout: true, fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 10 }, tabSize: 4, readOnly: !open,
              // A locked environment: no completion beyond what the learner types, so the editor never writes code for them.
              quickSuggestions: false, suggestOnTriggerCharacters: false, wordBasedSuggestions: "off", parameterHints: { enabled: false }, inlineSuggest: { enabled: false }, snippetSuggestions: "none",
            }} />
          {focus.resume && open ? (
            <div className="coding-resume" role="dialog" aria-label="Welcome back">
              <strong>Welcome back</strong>
              <p>You were away for {Math.round(focus.resume.awayMs / 60_000) || "<1"} min. Your code is as you left it.</p>
              <button className="coding-primary" type="button" onClick={focus.dismissResume}>Resume</button>
            </div>
          ) : null}
        </div>
        <Console attempt={attempt} tab={consoleTab} setTab={setConsoleTab} custom={custom} setCustom={setCustom} run={run} shown={shown} latest={latest} />
      </section>
      <TutorRail sessionId={sessionId} state={state} attempt={attempt} open={open} pending={pending} call={call} setState={setState} body={body} />
    </div>
  );
}

function Description({ attempt, onSeek }: { attempt: CodingAttemptView; onSeek: (ms: number) => void }) {
  const { problem } = attempt;
  return (
    <article className="coding-description">
      <h2>{problem.title}</h2>
      <div className="coding-tags"><span className={`coding-difficulty is-${problem.difficulty}`}>{problem.difficulty}</span><span className="coding-tag">{problem.conceptLabel}</span>{attempt.role !== "primary" ? <span className="coding-tag is-transfer">{attempt.role === "transfer" ? "Transfer" : "Reinforcement"}</span> : null}</div>
      <Prose text={problem.statement} className="coding-prose" />
      {problem.examples.map((example, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a problem's examples never reorder.
        <div key={index} className="coding-example">
          <strong>Example {index + 1}:</strong>
          <pre><b>Input:</b> {problem.signature.params.map((param, at) => `${param.name} = ${formatValue(example.args[at])}`).join(", ")}{"\n"}<b>Output:</b> {formatValue(example.expected)}{example.explanation ? <>{"\n"}<b>Explanation:</b> {example.explanation}</> : null}</pre>
        </div>
      ))}
      <strong>Constraints:</strong>
      <ul className="coding-constraints">{problem.constraints.map((line) => <li key={line}><Inline text={line.includes("`") ? line : `\`${line}\``} /></li>)}</ul>
      {problem.efficiencyStage ? <p className="coding-note">This problem has two stages: first a correct solution, then one fast enough for the largest inputs.</p> : null}
      {problem.moments.length ? <p className="coding-moments">From the lesson: {problem.moments.map((moment) => <button key={moment.startMs} type="button" className="coding-link" onClick={() => onSeek(moment.startMs)}>{moment.label}</button>)}</p> : null}
      {problem.related.length ? <p className="coding-related">Similar to: {problem.related.join(", ")}</p> : null}
    </article>
  );
}

function Submissions({ attempt }: { attempt: CodingAttemptView }) {
  if (!attempt.submissions.length) return <p className="coding-muted">No submissions yet.</p>;
  return (
    <table className="coding-submissions">
      <thead><tr><th>Status</th><th>Language</th><th>Runtime</th><th>Tests</th></tr></thead>
      <tbody>{attempt.submissions.map((submission) => <tr key={submission.id}><td className={submission.verdict === "accepted" ? "is-good" : submission.verdict === "accepted_slow" ? "is-warn" : "is-bad"}>{verdictLabel[submission.verdict]}</td><td>{codingLanguageLabels[submission.language]}</td><td>{submission.runtimeMs === null ? "-" : `${submission.runtimeMs} ms`}</td><td>{submission.passed}/{submission.total}</td></tr>)}</tbody>
    </table>
  );
}

function Solution({ attempt, pending, onReveal }: { attempt: CodingAttemptView; pending: Pending; onReveal: () => void }) {
  const [confirm, setConfirm] = useState(false);
  if (attempt.solution) return (
    <article className="coding-description">
      <h3>Approach <span className="coding-tag">{attempt.solution.time} time · {attempt.solution.space} space</span></h3>
      <Prose text={attempt.solution.approach} className="coding-prose" />
      <pre className="coding-code">{attempt.solution.code}</pre>
      <p className="coding-muted">The reference solution, in Python.</p>
    </article>
  );
  if (attempt.completedAt) return <p className="coding-muted">The solution isn't available right now.</p>;
  return (
    <div className="coding-locked">
      <Lock aria-hidden="true" />
      <p>The solution opens when you solve the problem.</p>
      {confirm ? <>
        <p className="coding-warning">Seeing it now ends this problem with no credit, and the idea comes back on a changed problem.</p>
        <div className="coding-row"><button type="button" className="coding-ghost" onClick={() => setConfirm(false)}>Keep trying</button><button type="button" className="coding-danger" disabled={pending === "reveal"} onClick={onReveal}>Show the solution</button></div>
      </> : <button type="button" className="coding-link" onClick={() => setConfirm(true)}>I give up, show me</button>}
    </div>
  );
}

function Console({ attempt, tab, setTab, custom, setCustom, run, shown, latest }: { attempt: CodingAttemptView; tab: "testcase" | "result"; setTab: (tab: "testcase" | "result") => void; custom: string[]; setCustom: (custom: string[]) => void; run: RunResponse["run"] | null; shown: "run" | "submit"; latest: SubmissionView | null }) {
  const { problem } = attempt;
  const [caseIndex, setCaseIndex] = useState(0);
  const total = problem.examples.length + custom.length;
  const index = Math.min(caseIndex, total - 1);
  return (
    <div className="coding-console">
      <div className="coding-tabs" role="tablist">
        <button role="tab" type="button" aria-selected={tab === "testcase"} onClick={() => setTab("testcase")}><Check aria-hidden="true" />Testcase</button>
        <button role="tab" type="button" aria-selected={tab === "result"} onClick={() => setTab("result")}>Test Result</button>
      </div>
      <div className="coding-console-body">
        {tab === "testcase" ? <>
          <div className="coding-cases">
            {Array.from({ length: total }, (_, at) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a case is its position ("Case 3"), so the index is its identity.
              <span key={at} className="coding-case">
                <button type="button" aria-pressed={at === index} onClick={() => setCaseIndex(at)}>Case {at + 1}</button>
                {at >= problem.examples.length ? <button type="button" className="coding-case-remove" aria-label={`Remove case ${at + 1}`} onClick={() => { setCustom(custom.filter((_, item) => item !== at - problem.examples.length)); setCaseIndex(Math.min(index, total - 2)); }}><X aria-hidden="true" /></button> : null}
              </span>
            ))}
            {custom.length < 4 ? <button type="button" title="Add a case of your own" onClick={() => { setCustom([...custom, caseText(problem.examples[0]!.args)]); setCaseIndex(total); }}>+</button> : null}
          </div>
          {index < problem.examples.length
            ? <Args signature={problem.signature} args={problem.examples[index]!.args} />
            : <label className="coding-field"><span>One JSON value per line: {problem.signature.params.map((param) => param.name).join(", ")}</span><textarea rows={problem.signature.params.length + 1} spellCheck={false} value={custom[index - problem.examples.length] ?? ""} onChange={(event) => setCustom(custom.map((text, item) => (item === index - problem.examples.length ? event.target.value : text)))} /></label>}
        </> : shown === "submit" && latest ? <SubmissionResult submission={latest} attempt={attempt} /> : run ? <RunResult run={run} attempt={attempt} /> : <p className="coding-muted">Run your code to see results here.</p>}
      </div>
    </div>
  );
}

function RunResult({ run, attempt }: { run: RunResponse["run"]; attempt: CodingAttemptView }) {
  const [at, setAt] = useState(0);
  if (run.verdict === "compile_error") return <div><h3 className="is-bad">Compile Error</h3><pre className="coding-output is-bad">{run.compileOutput}</pre></div>;
  const selected = run.cases[Math.min(at, run.cases.length - 1)];
  const passed = run.cases.every((item) => item.passed !== false) && run.verdict === "ran";
  return (
    <div>
      <h3 className={passed ? "is-good" : "is-bad"}>{run.verdict === "ran" ? (passed ? "Accepted" : "Wrong Answer") : runLabel[run.verdict]}</h3>
      {run.invalid.map((item) => <p key={item.index} className="coding-warning">Your case {attempt.problem.examples.length + item.index + 1} was skipped: {item.reason}</p>)}
      <div className="coding-cases">{run.cases.map((item, position) => <button key={`${run.custom[position] ? "c" : "e"}${item.index}`} type="button" aria-pressed={position === at} className={item.passed === true ? "is-good" : item.passed === false ? "is-bad" : ""} onClick={() => setAt(position)}>{run.custom[position] ? `Your case ${item.index + 1}` : `Case ${item.index + 1}`}</button>)}</div>
      {selected ? <>
        <Args signature={attempt.problem.signature} args={selected.args} />
        {selected.stdout ? <div className="coding-value"><span>Stdout</span><pre className="coding-output">{selected.stdout}</pre></div> : null}
        {selected.error ? <div className="coding-value"><span>Error</span><pre className="coding-output is-bad">{selected.error}</pre></div> : <div className="coding-value"><span>Output</span><code>{selected.passed === null && selected.output === null ? "(did not finish)" : formatValue(selected.output)}</code></div>}
        <div className="coding-value"><span>Expected</span><code>{selected.expected === null && run.custom[at] ? "(no reference answer)" : formatValue(selected.expected)}</code></div>
      </> : null}
    </div>
  );
}

function SubmissionResult({ submission, attempt }: { submission: SubmissionView; attempt: CodingAttemptView }) {
  const good = submission.verdict === "accepted";
  return (
    <div>
      <h3 className={good ? "is-good" : submission.verdict === "accepted_slow" ? "is-warn" : "is-bad"}>{verdictLabel[submission.verdict]}</h3>
      <p className="coding-muted">{submission.passed} / {submission.total} tests passed{submission.runtimeMs !== null ? ` · ${submission.runtimeMs} ms` : ""}{submission.memoryKb ? ` · ${(submission.memoryKb / 1024).toFixed(1)} MB` : ""}</p>
      {submission.verdict === "accepted_slow" ? <p>Every answer was right, but the largest inputs ran out of time. Find a faster approach, or keep this one for less credit.</p> : null}
      {submission.compileOutput ? <pre className="coding-output is-bad">{submission.compileOutput}</pre> : null}
      {submission.failure ? submission.failure.example ? <>
        <Args signature={attempt.problem.signature} args={submission.failure.example.args} />
        {submission.failure.error ? <div className="coding-value"><span>Error</span><pre className="coding-output is-bad">{submission.failure.error}</pre></div> : <div className="coding-value"><span>Output</span><code>{formatValue(submission.failure.output)}</code></div>}
        <div className="coding-value"><span>Expected</span><code>{formatValue(submission.failure.example.expected)}</code></div>
      </> : <p>A hidden test failed{submission.failure.error ? ` with ${submission.failure.error}` : ""}. Hidden tests stay hidden: think about inputs the examples don't cover.</p> : null}
    </div>
  );
}

const COACH_POLL_MS = 2_000;
const COACH_MAX_POLLS = 30;

/**
 * The live tutor. There is no chat box to type questions into: the tutor watches the attempt (runs, submissions, quiet
 * stretches, long unrun edits) and checks in on its own, like a teacher beside the learner. When it asks something, the
 * learner can answer it. Hints stay the explicit, credit-costing help, offered when the policy sees real struggle.
 */
function TutorRail({ sessionId, state, attempt, open, pending, call, setState, body }: { sessionId: string; state: CodingStateView; attempt: CodingAttemptView; open: boolean; pending: Pending; call: Call; setState: (state: CodingStateView) => void; body: () => { attemptId: string; language: CodingLanguage; code: string } }) {
  const [answer, setAnswer] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const { coach } = attempt;
  const feed = useMemo(() => [
    ...attempt.hints.map((hint) => ({ kind: "hint" as const, at: hint.createdAt, hint })),
    ...coach.messages.map((turn) => ({ kind: "talk" as const, at: turn.createdAt, turn })),
  ].sort((a, b) => a.at.localeCompare(b.at)), [attempt.hints, coach.messages]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new entry, or the tutor starting to write, is the trigger.
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [feed.length, coach.thinking]);
  // While the tutor writes a check-in, look again every couple of seconds until it lands.
  useEffect(() => {
    if (!coach.thinking) return;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      if (polls > COACH_MAX_POLLS) window.clearInterval(timer);
      else void codingApi(sessionId, "").then(setState, () => undefined);
    }, COACH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [coach.thinking, sessionId, setState]);
  const hint = () => void call("hint", async () => setState(await codingApi(sessionId, "/hint", { body: body() })));
  const reply = () => {
    const text = answer.trim();
    if (!text) return;
    setAnswer("");
    void call("reply", async () => setState(await codingApi(sessionId, "/reply", { body: { ...body(), message: text } })));
  };
  const next = () => void call("start", async () => setState(await codingApi(sessionId, "/next", { body: {} })));
  const cap = Math.round(attempt.creditCap * 100);
  const writing = coach.thinking || pending === "hint" || pending === "reply";
  return (
    <aside className="coding-tutor" aria-label="Tutor">
      <div className="coding-tutor-head">
        <strong><span className={`coding-live ${open ? "is-on" : ""}`} aria-hidden="true" />Tutor</strong>
        {open ? <span className="coding-credit" title="The most this problem can still earn. Hints, failed submissions and skipping the optimization lower it.">Max credit {cap}%</span> : null}
      </div>
      {attempt.completedAt ? (
        <div className="coding-result">
          <strong>{attempt.revealed ? "Solution shown" : "Solved"}</strong>
          <p>Credit {Math.round((attempt.credit ?? 0) * 100)}%. {attempt.outcome ? outcomeText[attempt.outcome] : ""}</p>
          {state.next ? <button className="coding-primary" type="button" disabled={pending === "start" || state.preparing.status === "preparing"} onClick={next}>{state.preparing.status === "preparing" ? "Preparing..." : state.next.label}</button> : null}
          {state.preparing.status === "failed" ? <p className="coding-warning">{state.preparing.message}</p> : null}
        </div>
      ) : null}
      {open && attempt.state === "OPTIMIZATION_STAGE" ? (
        <div className="coding-stage">
          <strong>Correct. Now make it fast.</strong>
          <p>Your solution is right but too slow for the largest inputs.</p>
          <button className="coding-link" type="button" disabled={pending === "skip"} onClick={() => void call("skip", async () => setState(await codingApi(sessionId, "/skip", { body: { attemptId: attempt.id } })))}>Keep my slower solution (credit ×0.7)</button>
        </div>
      ) : null}
      <div className="coding-feed" ref={listRef} aria-live="polite">
        {!feed.length && !writing ? <p className="coding-muted">Your tutor follows your runs and submissions and checks in when it can help. It never writes your code.</p> : null}
        {feed.map((entry) => entry.kind === "hint"
          ? <div key={`h${entry.at}`} className="coding-hint"><span><Lightbulb aria-hidden="true" />Hint {entry.hint.level}{entry.hint.stage === "efficient" ? " · speed" : ""}</span><Prose text={entry.hint.text} /></div>
          : <div key={`c${entry.at}${entry.turn.role}`} className={`coding-turn is-${entry.turn.role}`}><Prose text={entry.turn.text} /></div>)}
        {open && attempt.offer ? (
          <div className="coding-offer" role="status">
            <p>{attempt.offer.text}</p>
            <div className="coding-row">
              <button className="coding-primary" type="button" disabled={pending !== null} onClick={hint}>Yes, a hint</button>
              <button className="coding-ghost" type="button" disabled={pending !== null} onClick={() => void call("decline", async () => setState(await codingApi(sessionId, "/decline", { body: { attemptId: attempt.id } })))}>I'll keep going</button>
            </div>
          </div>
        ) : null}
        {writing ? <div className="coding-turn is-tutor"><span className="coding-typing" role="status" aria-label="The tutor is writing"><i /><i /><i /></span></div> : null}
      </div>
      {coach.canReply && !writing ? (
        <form className="coding-ask" onSubmit={(event) => { event.preventDefault(); reply(); }}>
          <label className="sr-only" htmlFor="coding-answer">Answer the tutor</label>
          <textarea id="coding-answer" rows={2} maxLength={1_000} placeholder="Answer the tutor..." value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); reply(); } }} />
          <button type="submit" aria-label="Send your answer" disabled={!answer.trim() || pending !== null}><Send aria-hidden="true" /></button>
        </form>
      ) : null}
      {open && attempt.nextHint ? (
        <div className="coding-hint-bar">
          <button className="coding-ghost" type="button" disabled={pending !== null || (!attempt.nextHint.available && !attempt.offer)} onClick={hint}><Lightbulb aria-hidden="true" />Hint {attempt.nextHint.level} <small>→ max {Math.round(attempt.nextHint.capAfter * 100)}%</small></button>
          {!attempt.nextHint.available && attempt.nextHint.wait ? <small>{attempt.nextHint.wait}</small> : null}
        </div>
      ) : null}
    </aside>
  );
}
