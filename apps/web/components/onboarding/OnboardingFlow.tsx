"use client";

import {
  PERSONA_INTENTS,
  PERSONAS,
  PREFERRED_DURATIONS,
  PREFERRED_FORMATS,
  STARTING_LEVEL_OPTIONS,
  type OnboardingDraft,
  type OnboardingDraftRequest,
  type Persona,
  type PreferredDuration,
  type PreferredFormat,
  type SelfReportedLevel,
  type StartingLevelOptionId,
} from "@learnspace/shared/onboarding";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Concept = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  summary: string | null;
};

type InitialState = {
  completed: boolean;
  completedAt: string | null;
  version: number | null;
  draft: OnboardingDraft;
  selectedConcepts: Concept[];
};

type FlowState = {
  persona: Persona | undefined;
  learningIntents: string[];
  preferredFormats: PreferredFormat[];
  preferredDuration: PreferredDuration;
  selfReportedLevel: SelfReportedLevel | undefined;
  startingLevelOption: StartingLevelOptionId | undefined;
};

type ApiError = { error?: { message?: string } };

const personaLabels: Record<Persona, string> = {
  student: "Student",
  professional: "Working Professional",
  researcher: "Researcher / Academic",
  builder: "Builder / Creator",
  lifelong_learner: "Lifelong Learner",
  other: "Other",
};

const formatLabels: Record<PreferredFormat, string> = {
  clear_explanations: "Clear explanations",
  deep_dives: "Deep dives",
  learn_by_building: "Learn by building",
  research_backed: "Research-backed",
  quick_learning: "Quick learning",
  conversational_tutor_led: "Conversational / tutor-led",
};

const durationLabels: Record<PreferredDuration, string> = {
  under_10_minutes: "<10 min",
  ten_to_thirty_minutes: "10–30 min",
  thirty_to_sixty_minutes: "30–60 min",
  no_preference: "No preference",
};

function initialFlow(draft: OnboardingDraft): FlowState {
  const startingLevelOption = draft.selfReportedLevel
    ? STARTING_LEVEL_OPTIONS.find((option) => option.value === draft.selfReportedLevel)?.id
    : undefined;
  return {
    ...(draft.persona ? { persona: draft.persona } : { persona: undefined }),
    learningIntents: draft.learningIntents ?? [],
    preferredFormats: draft.preferredFormats ?? [],
    preferredDuration: draft.preferredDuration ?? "no_preference",
    selfReportedLevel: draft.selfReportedLevel,
    startingLevelOption,
  };
}

function initialConcepts(selectedConcepts: Concept[]): Concept[] {
  return selectedConcepts;
}

function isAllowedIntent(persona: Persona, intent: string): boolean {
  return PERSONA_INTENTS[persona].some((candidate) => candidate === intent);
}

const intentLabels: Record<string, string> = {
  coursework: "Coursework",
  exams: "Exams",
  placements_interviews: "Placements / interviews",
  learn_new_skill: "Learn a new skill",
  build_project: "Build a project",
  research: "Research",
  explore: "Explore",
  upskill_current_role: "Upskill in current role",
  career_switch: "Career switch",
  interview_preparation: "Interview preparation",
  learn_new_technology: "Learn a new technology",
  build_something: "Build something",
  keep_up_with_field: "Keep up with my field",
  explore_outside_work: "Explore outside work",
  read_papers: "Read papers",
  follow_research_area: "Follow a research area",
  understand_unfamiliar_concepts: "Understand unfamiliar concepts",
  reproduce_implementations: "Reproduce implementations",
  literature_review: "Literature review",
  discover_related_work: "Discover related work",
  teaching_preparation: "Teaching / preparation",
  learn_technology: "Learn a technology",
  prototype_idea: "Prototype an idea",
  understand_how_something_works: "Understand how something works",
  improve_skill: "Improve a skill",
  find_inspiration: "Find inspiration",
  understand_something_deeply: "Understand something deeply",
  explore_interesting_topics: "Explore interesting topics",
  develop_new_skills: "Develop new skills",
  read_more_deeply: "Read more deeply",
  follow_curiosity: "Follow curiosity",
};

function apiErrorMessage(data: ApiError): string {
  return data.error?.message ?? "We could not save your learning preferences.";
}

const BLOOM_SEED = 174074637;
const BLOOM_GRAIN_LAYER =
  "url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.280'/></svg>\")";

const BLOOM_BLOBS = [
  { baseX: 66.94, baseY: 46.43, color: "251, 233, 240", stops: [19.02, 38.05, 57.07, 76.1] },
  { baseX: 34.69, baseY: 66.31, color: "205, 231, 240", stops: [12.73, 25.45, 38.18, 50.9] },
  { baseX: 48.93, baseY: 19.32, color: "230, 214, 245", stops: [16.75, 33.5, 50.25, 67] },
  { baseX: 80.23, baseY: 87.54, color: "214, 240, 228", stops: [10.28, 20.55, 30.83, 41.1] },
] as const;

function seededBloomPhase(index: number, offset: number): number {
  return (Math.sin(BLOOM_SEED + index * 13.37 + offset * 29.11) * 0.5 + 0.5) * Math.PI * 2;
}

const BLOOM_PHASES = BLOOM_BLOBS.map((_, index) => ({
  p: seededBloomPhase(index, 0),
  p2: seededBloomPhase(index, 1),
}));

function buildBloomBackground(ph: number): string {
  const amt = 0.40;
  const dir = 1;
  const spin = ph * dir;
  const layers = BLOOM_BLOBS.map((blob, index) => {
    const phase = BLOOM_PHASES[index];
    if (!phase) {
      return "";
    }
    const { p, p2 } = phase;
    const x = blob.baseX + (Math.sin(spin * 0.55 + p) - Math.sin(p)) * 14 * amt;
    const y = blob.baseY + (Math.sin(spin * 0.43 + p2) - Math.sin(p2)) * 14 * amt;
    const [stop1, stop2, stop3, stop4] = blob.stops;

    return `radial-gradient(circle at ${x}% ${y}%, rgba(${blob.color}, 1) 0%, rgba(${blob.color}, 0.844) ${stop1}%, rgba(${blob.color}, 0.5) ${stop2}%, rgba(${blob.color}, 0.156) ${stop3}%, rgba(${blob.color}, 0) ${stop4}%)`;
  });

  return [BLOOM_GRAIN_LAYER, ...layers].join(",\n");
}

export function OnboardingFlow({
  firstName,
  initialState,
}: {
  firstName: string;
  initialState: InitialState;
}) {
  const router = useRouter();
  const pageRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [flow, setFlow] = useState(() => initialFlow(initialState.draft));
  const [selectedConcepts, setSelectedConcepts] = useState(() =>
    initialConcepts(initialState.selectedConcepts),
  );
  const [draftRevision, setDraftRevision] = useState(initialState.draft.draftRevision ?? 0);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [conceptQuery, setConceptQuery] = useState("");
  const [conceptLoading, setConceptLoading] = useState(false);
  const [conceptError, setConceptError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) {
      return;
    }

    page.style.backgroundImage = buildBloomBackground(0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = (now - start) / 1000;
      const ph = t * 1.0;
      page.style.backgroundImage = buildBloomBackground(ph);
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (step !== 3) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setConceptLoading(true);
      setConceptError("");
      try {
        const response = await fetch(
          `/api/onboarding/concepts?q=${encodeURIComponent(conceptQuery)}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as { concepts?: Concept[] } & ApiError;
        if (!response.ok) {
          setConceptError(apiErrorMessage(data));
          return;
        }
        setConcepts(data.concepts ?? []);
        setSelectedConcepts((current) =>
          current.map((selected) => data.concepts?.find((concept) => concept.id === selected.id) ?? selected),
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setConceptError("We could not load the interest catalog.");
        }
      } finally {
        setConceptLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [conceptQuery, step]);

  function buildDraft(revision: number): OnboardingDraftRequest {
    return {
      ...(flow.persona ? { persona: flow.persona } : {}),
      learningIntents: flow.learningIntents,
      preferredFormats: flow.preferredFormats,
      preferredDuration: flow.preferredDuration,
      ...(flow.selfReportedLevel ? { selfReportedLevel: flow.selfReportedLevel } : {}),
      conceptIds: selectedConcepts.map((concept) => concept.id),
      draftRevision: revision,
    };
  }

  async function persistDraft(): Promise<boolean> {
    if (isSaving) {
      return false;
    }

    const nextRevision = draftRevision + 1;
    setIsSaving(true);
    try {
      const response = await fetch("/api/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildDraft(nextRevision)),
      });
      const data = (await response.json()) as ApiError & { state?: InitialState };
      if (!response.ok) {
        setSaveError(apiErrorMessage(data));
        return false;
      }
      setDraftRevision(Math.max(nextRevision, data.state?.draft.draftRevision ?? nextRevision));
      setSaveError("");
      return true;
    } catch {
      setSaveError("Your progress could not be saved yet.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  function toggleIntent(intent: string) {
    setFlow((current) => ({
      ...current,
      learningIntents: current.learningIntents.includes(intent)
        ? current.learningIntents.filter((selected) => selected !== intent)
        : [...current.learningIntents, intent],
    }));
  }

  function toggleFormat(format: PreferredFormat) {
    setFlow((current) => ({
      ...current,
      preferredFormats: current.preferredFormats.includes(format)
        ? current.preferredFormats.filter((selected) => selected !== format)
        : [...current.preferredFormats, format],
    }));
  }

  function toggleConcept(concept: Concept) {
    setSelectedConcepts((current) =>
      current.some((selected) => selected.id === concept.id)
        ? current.filter((selected) => selected.id !== concept.id)
        : [...current, concept],
    );
  }

  function selectPersona(persona: Persona) {
    setFlow((current) => ({
      ...current,
      persona,
      learningIntents: current.learningIntents.filter((intent) => isAllowedIntent(persona, intent)),
    }));
  }

  async function goBack() {
    if (isSaving) {
      return;
    }
    setSubmitError("");
    if (step === 0 || (await persistDraft())) {
      setStep((current) => Math.max(0, current - 1));
    }
  }

  async function goForward() {
    if (isSaving) {
      return;
    }
    setSubmitError("");
    if (step === 0 || (await persistDraft())) {
      setStep((current) => Math.min(5, current + 1));
    }
  }

  async function complete() {
    if (
      !flow.persona ||
      flow.learningIntents.length === 0 ||
      flow.preferredFormats.length === 0 ||
      !flow.selfReportedLevel
    ) {
      setSubmitError("Finish each step before completing setup.");
      return;
    }
    if (selectedConcepts.length < 3) {
      setSubmitError("Choose at least three interests to continue.");
      return;
    }

    setSubmitError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona: flow.persona,
          learningIntents: flow.learningIntents,
          preferredFormats: flow.preferredFormats,
          preferredDuration: flow.preferredDuration,
          selfReportedLevel: flow.selfReportedLevel,
          conceptIds: selectedConcepts.map((concept) => concept.id),
        }),
      });
      const data = (await response.json()) as ApiError & { ok?: boolean };
      if (!response.ok) {
        setSubmitError(apiErrorMessage(data));
        return;
      }
      router.replace("/app");
      router.refresh();
    } catch {
      setSubmitError("We could not finish setting up your space. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const currentPersonaIntents = flow.persona ? PERSONA_INTENTS[flow.persona] : [];
  const visibleConcepts = concepts.filter(
    (concept) => !selectedConcepts.some((selected) => selected.id === concept.id),
  );

  return (
    <main ref={pageRef} className="onboarding-page">
      <section
        className="onboarding-shell"
        aria-labelledby="onboarding-title"
        data-onboarding-hydrated={isHydrated ? "true" : "false"}
      >
        {step > 0 ? (
          <header className="onboarding-header">
            <span className="onboarding-progress">Step {step} of 5</span>
          </header>
        ) : null}

        <div className="onboarding-content">
          {step === 0 ? (
            <div className="onboarding-welcome">
              <span className="onboarding-kicker">A space made for your mind</span>
              <h1 id="onboarding-title">Welcome, {firstName}.</h1>
              <p>Let&apos;s shape this place around how you learn.</p>
              <button className="onboarding-primary" type="button" onClick={goForward}>
                Get started <span aria-hidden="true">↗</span>
              </button>
            </div>
          ) : (
            <>
              <div className="onboarding-heading">
                <span className="onboarding-kicker">Your learning profile</span>
                {step === 1 ? <h1 id="onboarding-title">How do you see yourself learning?</h1> : null}
                {step === 2 ? <h1 id="onboarding-title">What brings you here?</h1> : null}
                {step === 3 ? <h1 id="onboarding-title">What could you spend hours learning about?</h1> : null}
                {step === 4 ? <h1 id="onboarding-title">What helps ideas stick?</h1> : null}
                {step === 5 ? <h1 id="onboarding-title">Where are you starting from?</h1> : null}
                {step === 1 ? <p>Choose the path that feels closest right now.</p> : null}
                {step === 2 ? <p>Select everything that sounds like you.</p> : null}
                {step === 3 ? <p>Pick at least three. You can always change these later.</p> : null}
                {step === 4 ? <p>There is no wrong way to learn. Choose what feels useful.</p> : null}
                {step === 5 ? <p>We&apos;ll use this as a starting point, never a label.</p> : null}
              </div>

              {step === 1 ? (
                <fieldset className="onboarding-options onboarding-personas">
                  <legend className="sr-only">Persona</legend>
                  {PERSONAS.map((persona) => (
                    <button
                      className={`onboarding-option ${flow.persona === persona ? "is-selected" : ""}`}
                      type="button"
                      aria-pressed={flow.persona === persona}
                      key={persona}
                      onClick={() => selectPersona(persona)}
                    >
                      <span>{personaLabels[persona]}</span>
                      <span className="onboarding-option-check" aria-hidden="true">{flow.persona === persona ? "✓" : ""}</span>
                    </button>
                  ))}
                </fieldset>
              ) : null}

              {step === 2 ? (
                <fieldset className="onboarding-options onboarding-intents">
                  <legend className="sr-only">Learning intentions</legend>
                  {currentPersonaIntents.map((intent) => (
                    <button
                      className={`onboarding-option ${flow.learningIntents.includes(intent) ? "is-selected" : ""}`}
                      type="button"
                      aria-pressed={flow.learningIntents.includes(intent)}
                      key={intent}
                      onClick={() => toggleIntent(intent)}
                    >
                      <span>{intentLabels[intent] ?? intent}</span>
                      <span className="onboarding-option-check" aria-hidden="true">{flow.learningIntents.includes(intent) ? "✓" : ""}</span>
                    </button>
                  ))}
                </fieldset>
              ) : null}

              {step === 3 ? (
                <div className="onboarding-interest-picker">
                  <label className="onboarding-search">
                    <span className="sr-only">Search interests</span>
                    <span aria-hidden="true">⌕</span>
                    <input
                      type="search"
                      value={conceptQuery}
                      onChange={(event) => setConceptQuery(event.target.value)}
                      placeholder="Search topics, skills, or domains"
                    />
                  </label>
                  <div className="onboarding-selected" aria-live="polite">
                    {selectedConcepts.map((concept) => (
                      <button
                        className="onboarding-chip is-selected"
                        type="button"
                        key={concept.id}
                        onClick={() => toggleConcept(concept)}
                      >
                        {concept.name} <span aria-hidden="true">×</span>
                      </button>
                    ))}
                  </div>
                  {conceptLoading ? <p className="onboarding-muted">Finding concepts…</p> : null}
                  {conceptError ? <p className="onboarding-inline-error" role="alert">{conceptError}</p> : null}
                  <div className="onboarding-concept-grid">
                    {visibleConcepts.map((concept) => (
                      <button className="onboarding-chip" type="button" key={concept.id} onClick={() => toggleConcept(concept)}>
                        <span>{concept.name}</span>
                        <small>{concept.kind}</small>
                      </button>
                    ))}
                  </div>
                  {!conceptLoading && visibleConcepts.length === 0 ? (
                    <p className="onboarding-muted">No matching concepts yet. Try a broader search.</p>
                  ) : null}
                  <p className="onboarding-selection-count">{selectedConcepts.length} selected · minimum 3</p>
                </div>
              ) : null}

              {step === 4 ? (
                <div className="onboarding-style-stack">
                  <fieldset className="onboarding-options onboarding-format-grid">
                    <legend className="onboarding-field-label">Learning style</legend>
                    {PREFERRED_FORMATS.map((format) => (
                      <button
                        className={`onboarding-option ${flow.preferredFormats.includes(format) ? "is-selected" : ""}`}
                        type="button"
                        aria-pressed={flow.preferredFormats.includes(format)}
                        key={format}
                        onClick={() => toggleFormat(format)}
                      >
                        <span>{formatLabels[format]}</span>
                        <span className="onboarding-option-check" aria-hidden="true">{flow.preferredFormats.includes(format) ? "✓" : ""}</span>
                      </button>
                    ))}
                  </fieldset>
                  <fieldset className="onboarding-choice-row">
                    <legend className="onboarding-field-label">Typical learning time</legend>
                    {PREFERRED_DURATIONS.map((duration) => (
                      <button
                        className={`onboarding-small-option ${flow.preferredDuration === duration ? "is-selected" : ""}`}
                        type="button"
                        aria-pressed={flow.preferredDuration === duration}
                        key={duration}
                        onClick={() => setFlow((current) => ({ ...current, preferredDuration: duration }))}
                      >
                        {durationLabels[duration]}
                      </button>
                    ))}
                  </fieldset>
                </div>
              ) : null}

              {step === 5 ? (
                <fieldset className="onboarding-level-list">
                  <legend className="sr-only">Starting level</legend>
                  {STARTING_LEVEL_OPTIONS.map((option) => (
                    <button
                      className={`onboarding-level-option ${flow.startingLevelOption === option.id ? "is-selected" : ""}`}
                      type="button"
                      aria-pressed={flow.startingLevelOption === option.id}
                      key={option.id}
                      onClick={() =>
                        setFlow((current) => ({
                          ...current,
                          selfReportedLevel: option.value,
                          startingLevelOption: option.id,
                        }))
                      }
                    >
                      <span className="onboarding-level-dot" aria-hidden="true" />
                      <span>{option.label}</span>
                      <span className="onboarding-option-check" aria-hidden="true">{flow.startingLevelOption === option.id ? "✓" : ""}</span>
                    </button>
                  ))}
                </fieldset>
              ) : null}

              {saveError ? <p className="onboarding-inline-error" role="status">{saveError}</p> : null}
              {submitError ? <p className="onboarding-inline-error" role="alert">{submitError}</p> : null}

              <div className="onboarding-actions">
                <button className="onboarding-back" type="button" onClick={goBack}>
                  <span aria-hidden="true">←</span> Back
                </button>
                {step < 5 ? (
                  <button
                    className="onboarding-primary"
                    type="button"
                    onClick={goForward}
                    disabled={
                      (step === 1 && !flow.persona) ||
                      (step === 2 && flow.learningIntents.length === 0) ||
                      (step === 3 && selectedConcepts.length < 3) ||
                      (step === 4 && flow.preferredFormats.length === 0)
                    }
                  >
                    Continue <span aria-hidden="true">↗</span>
                  </button>
                ) : (
                  <button className="onboarding-primary" type="button" onClick={complete} disabled={isSubmitting || isSaving || !flow.selfReportedLevel}>
                    {isSubmitting ? "Saving your space…" : "Start learning"} <span aria-hidden="true">↗</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
