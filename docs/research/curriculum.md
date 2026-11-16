# Research Discover curriculum

The curriculum is a versioned, static catalog for goal-based paper tracks. Stages describe the broad learning progression; tracks choose stage modules for a learner goal, and a specialised track builds on `ml-foundations` (`prerequisiteTrackIds`) instead of repeating its modules; each module references shared item IDs. Paper items form a prerequisite DAG, so a paper can be shared by multiple tracks without duplicating its metadata. The four mathematical foundations are concept nodes because they are not paper citations.

Each paper's title, ordered authors, year, arXiv identifier, DOI, and journal reference (when supplied) come from the arXiv Atom API. `venue` and `doi` are `null` when arXiv does not provide them. The original inclusion reason, difficulty, concepts, prerequisites, required/optional choice, and coding-applicability hint are editorial curriculum fields. Coding applicability is only a hint to a later exercise planner; `cpu-plausible` does not promise an exercise.

## Verification and updates

Run the verifier from the repository root inside the web container:

```sh
docker exec -w /workspace learnspace-web-1 pnpm --filter @learnspace/web exec tsx /workspace/scripts/research-curriculum/verify.ts
```

The script batches arXiv API requests in groups of ten, waits between uncached batches, and stores raw normalized records in `scripts/research-curriculum/.cache/` (gitignored). It requires an exact identifier match and complete title, author, and publication-year fields. For an existing dataset it compares those fields to the authoritative response and checks that the committed paper identifier set still matches the verified candidate set. Missing/unresolvable candidates are omitted and listed in the result. Review those results and update the dataset intentionally with `--write`:

```sh
docker exec -w /workspace learnspace-web-1 pnpm --filter @learnspace/web exec tsx /workspace/scripts/research-curriculum/verify.ts --write
```

`verifiedAt` records the dataset generation time and `verifiedSource` names the authoritative source. The committed `apps/web/lib/research/curriculum/data.json` currently has 120 unique papers; one unresolved candidate (`2000.01412`) was excluded. The verifier uses a generic `LearnSpace/1.0` User-Agent and makes no user-specific requests.

## Server-side API

`apps/web/lib/research/curriculum/index.ts` exports:

- `listResearchTracks(): CurriculumTrack[]`
- `getResearchTrack(trackId: string): ResearchTrackDag | null` — track, unique items, prerequisite edges, and topological item order.
- `computeResearchTrackState(trackId, progress, profile): PersonalizedTrackState | null` — pure learner-state calculation. `progress` is a `ReadonlyMap` keyed by arXiv ID or DOI, with `status`, `progressPct`, and `lastOpenedAt`; `profile` carries the self-reported level and interests. A paper is done when marked completed or at least 90% complete. Opening a paper alone never unlocks its dependents. Optional items still wait for their prerequisites. Concepts are refreshers and never gate a step. A paper from a prerequisite track gates only learners who report as beginners; each locked step lists what it is `waitingOn`.

The function returns per-item status, core-paper track completion percentage, up to three prerequisite-ready recommendations ranked by interest and learner level, and the topological core path (including foundation concepts). It does not read learner or database state; callers supply the map assembled from their own persistence layer.

The schema and inferred model types live in `packages/shared/src/research-curriculum.ts`. To expose them through the shared package barrel, add:

```ts
export * from "./research-curriculum.js";
```

## Extending the catalog

Add a candidate to `scripts/research-curriculum/verify.ts` with its arXiv ID and original, contribution-grounded rationale, then verify it before generating the dataset. Prefer a canonical paper; use an optional item for a useful alternative route. Give each item a stage, key concepts, difficulty, and a prerequisite pointing only to an existing item. Add the item to track modules through the stage selection in `trackSpecs`; tracks that use an item's stage must also include the prerequisite stage, unless a prerequisite track covers it. Run the verifier, then the curriculum unit test. The test validates schema shape, verified metadata fields, reference integrity, per-track prerequisite closure, and acyclicity.
