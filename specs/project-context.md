# LearnSpace — Project Context

## 1. Product Definition

LearnSpace is an AI-native learning, research, practice, and knowledge-retention system. It must not degrade into a YouTube wrapper, course catalog, chatbot, or just a note-taking app.

The Primary system loop:

`Discover(Learnspace FYP) -> Consume -> Query -> Practice -> Research -> Implement -> Capture -> Connect -> Revisit`

The core architectural invariant is **persistent learning context across heterogeneous resources**. The source material from which the users study are mainly of Youtube Videos and Research papers. Apart from this the user could also take notes with the application, code and practice based upon the videos, tutor conversations, exercises/quizzes after every video, and user-generated artifacts must converge into the same learner model and Second Brain

The canonical orchestration primitive should be a **Study Session**, not a video page or research page.

---

## 2. Techstack and deets

### TechStack

- Next.js + React  + TypeScript 
- Drizzle ORM + PostgreSQL
- Redis / `ioredis`
- TanStack Query
- Radix UI + Tailwind
- SSE-based agent streaming
Note that you must use only the latest version of each of the languages/tech stack mentioned above. 

### AI Backend

`services/ai-backend` is a FastAPI/Python service with:

- agent planner/executor
- DAG-style tool orchestration
- web research / LLM / code-interpreter tool abstraction
- agent run persistence
- Redis/Postgres-backed jobs
- recommendation quality scoring
- crawler/discovery infrastructure



---

## 3. Target Domain Model

```text
User
  -> LearningGoal / Topic
  -> Resource[]
       video | paper | pdf | webpage | note | code artifact
  -> StudySession
       -> SessionResource[]
       -> SessionContext
       -> ActivityEvent[]
       -> TutorThread[]
       -> Exercise[]
       -> Artifact[]
  -> Concept[]
  -> MasterySignal[]
  -> KnowledgeEdge[]
  -> SecondBrain
```

`StudySession` is the shared state container for resource context, learner intent, retrieval scope, tutor state, exercises, notes, implementations, unresolved questions, and mastery updates.

---

## 4. Entry Flow A — Topic Learning from a Youtube Video

Example: `User watches a video: Learn Python generators`.

### Retrieval + Ranking

1. Extract the youtube transcripts. 
2. Resolve query -> canonical topic/concepts.
3. Retrieve candidate resources, initially YouTube-heavy but resource-agnostic internally.
4. Rank using a composite quality function, not raw popularity.

Recommended ranking features for Youtube videos:

```text
semantic_relevance
* bayesian_engagement_quality
* learner_affinity
* completion/retention_prior
* content_coverage
* freshness_prior
* diversity_penalty
```

You could use Wilson-adjusted likes/views and comments/views signals plus freshness and internal completion rate. However, the current persisted compute path does not yet populate all of these signals; ingestion must capture `like_count`, `comment_count`, and internal completion/retention telemetry for the quality model to become effective.

### Transcript Intelligence

For each selected video:

`YouTube -> transcript -> timestamped segments -> semantic chunks -> embeddings -> concept map`

Required entities:

- `resource_chunks`
- timestamp spans
- embeddings
- detected concepts
- prerequisite links
- code/example spans
- retrieval metadata

Q&A must be **resource-grounded**, returning timestamp/source references rather than generic model knowledge when the user is asking about the current lesson.

### Coding Applicability Router

A classifier/router determines whether a video segment requires active coding.

Signals may include:

- topic taxonomy (`programming`, `algorithms`, `SQL`, etc.)
- transcript code density
- detected syntax/API references
- instructor activity classification (`explanation` vs `implementation`)
- concept mastery state
- exercise availability/generation confidence

When triggered, create an `Exercise` bound to the relevant concept/time range.

### Focused Monaco Exercise

Target flow:

`video checkpoint -> exercise gate -> Monaco -> sandbox execution -> hidden tests -> observer feedback -> completion -> resume lesson`

The exercise is non-skippable within LearnSpace's learning flow.

The browser can enforce application-level focus and detect `visibilitychange`/blur events, but **cannot guarantee OS-level prevention of tab/app switching**. Hard lock semantics require a managed browser, kiosk mode, or desktop shell.

Code execution must run in an isolated execution service/container with:

- CPU/time/memory quotas
- no outbound network by default
- restricted filesystem
- process isolation
- hidden tests
- deterministic execution traces

### Code Observer / Tutor Agent

The observer consumes:

- code diffs
- compiler/runtime errors
- failing test cases
- execution traces
- cursor/edit cadence where useful
- prior hint history
- concept/mastery state

It emits:

- misconception classification
- minimal diagnostic hint
- next-step hint level
- targeted concept recall
- eventual guided debugging only after repeated failure

Default pedagogy is a progressive **Hint Ladder**, not direct solution generation.

---

## 5. Entry Flow B — Research / Paper Study

Input sources:

- arXiv URL/ID
- DOI
- uploaded PDF
- later: arbitrary scholarly/web resources

Pipeline:

`import -> parse -> section/figure/equation extraction -> chunk -> embed -> citation graph -> Study Session`

### Paper-Grounded RAG

Retrieval scope must preserve:

- section hierarchy
- page/paragraph anchors
- equations
- tables/figures
- references/citations

Answers must cite paper-local evidence. External research must be explicitly separated from paper-grounded claims.

### Deep Research Agent

The current backend already provides DAG-style research planning/tool execution. Extend it into a study-session-aware research agent capable of:

- citation chasing
- related-paper discovery
- implementation/repository discovery
- prerequisite resolution
- equation/concept decomposition
- evidence synthesis

Its state must persist into the active Study Session rather than existing as an isolated agent transcript.

### Implementation Workspace

Research sessions may attach:

- Monaco/code workspace
- sandbox runtime
- scratchpad / notebook
- structured notes
- implementation artifacts
- open questions

Paper -> explanation -> implementation -> result should remain one connected provenance chain.

---

## 6. Realtime Spatial Tutor

The tutor is a separate low-latency interaction layer from Deep Research. Similar to Farza's HeyClicky macOS application.

Target architecture:

```text
Global hotkey
 -> user-authorized screen/window capture
 -> multimodal context encoder with a voice agent. 
 -> session context resolver
 -> realtime voice model
 -> tutoring policy
 -> annotation/computer-use tool layer
 -> overlay rendering
```

Capabilities:

- understand current visible screen context
- answer by voice
- point/highlight/draw over visible content
- inspect active LearnSpace session state
- invoke scoped tools when required

For true desktop-wide spatial context, implement as a **desktop companion/shell** (e.g. Tauri-class architecture) rather than relying exclusively on browser APIs. Screen capture and computer-control permissions must be explicit, scoped, observable, and revocable.

---

## 7. Second Brain / Learner State

The Second Brain is not a note repository. It is the persistent knowledge graph derived from learning activity.

Core entities to introduce/evolve:

- `concepts`
- `concept_edges`
- `study_sessions`
- `session_resources`
- `resource_chunks`
- `learning_artifacts`
- `exercises`
- `exercise_attempts`
- `hint_events`
- `mastery_signals`
- `concept_mastery`

Mastery signals may originate from:

- video completion/rewatch behavior
- RAG questions
- quiz/exercise correctness
- code attempts
- hint dependence
- research notes
- tutor conversations
- spaced-repetition outcomes

The system should infer **what the learner knows, what is weak, what depends on what, and what should be revisited next**.

---

## 8. Agent Topology

Prefer specialized, tool-scoped agents developed through CrewAI over one monolithic agent:

- **Session Orchestrator** — owns Study Session state transitions
- **Retrieval/RAG Agent** — source-grounded retrieval and synthesis
- **Web Search Agents** - two primary search agents to retrieve youtube videos based upon the user interest and retrieve arXiv papers. Use the YoutubeVideoSearchTool and ArxivPaperTool developed by CrewAI. 
- **Recommendation Agent** — candidate ranking/personalization
- **Practice Router/Generator** — decides when practice is required
- **Code Observer Agent** — diagnoses attempts and controls Hint Ladder
- **Deep Research Agent** — external evidence acquisition/synthesis
- **Realtime Tutor** — low-latency multimodal tutoring
- **Memory Writer** — converts validated interactions into concepts/mastery/graph updates

Agents should exchange typed events/artifacts through persistent session state; avoid hidden cross-agent memory.

---

## 9. Architectural Migration Priorities

1. Introduce `study_sessions` as the central context primitive.
2. Make activity/focus/history resource-agnostic (`resource_id`, `study_session_id`).
3. Add transcript/document chunk + embedding storage.
4. Implement grounded video RAG with timestamp citations.
5. Add coding applicability router + Monaco exercise gate.
6. Build isolated code execution + hidden-test service.
7. Implement Code Observer + progressive hint policy.
8. Complete paper ingestion + paper-grounded RAG.
9. Attach Deep Research outputs to Study Sessions.
10. Build concept/mastery graph and Second Brain writer.
11. Add realtime voice tutor.
12. Add desktop spatial tutor/annotation layer after web learning primitives are stable.

---

## 10. Non-Negotiable System Invariants

- YouTube is a **resource provider**, not the product architecture.
- All learning surfaces must converge into persistent learner state.
- RAG answers must preserve source provenance.
- AI should scaffold reasoning, not bypass required practice.
- Code exercises must execute outside the web process in a sandbox.
- Strict anti-tab/app switching is not a browser-guaranteed feature.
- Research output, notes, code, tutor interactions, and exercises must remain attached to their originating Study Session/concepts.
- Recommendation quality should optimize **learning utility**, not views/clicks alone.
- Second Brain writes should be evidence-backed and reversible/updateable rather than unrestricted LLM memory writes.

---

## 11. v1 User-Facing Learning Architecture

`StudySession` remains the canonical persistent learning-context aggregate. It owns the shared context for resources, progress, questions, notes/artifacts, tutor state, concepts, activity, checkpoints, and future practice or research state.

The user-facing study experience is resource-specific over that same aggregate:

- Video Study: `/app/study/video/[sessionId]`
- Paper Study: `/app/study/paper/[sessionId]`
- Future Practice/Code Study: a later focused presentation

Changing the active resource changes the presentation and route, not the persistent learning context or session mode. Related videos and papers can therefore be attached and activated within the same session.

The application information architecture is:

- Home / Discover: algorithmic personalized discovery
- Library: saved resources, playlists/collections, and learning paths
- Sessions: current and historical learning contexts
- Research: scholarly discovery, search, and organization
- Video Study and Paper Study: the focused places where learning happens
- Second Brain: a later learner-state and knowledge surface

YouTube remains a resource provider, not the product architecture. A catalogue resource may begin a session before immutable source ingestion exists; the session records a preparing binding and pins a real `resource_version` only after ingestion makes one available. No synthetic transcript, PDF snapshot, hash, or citation is valid.
