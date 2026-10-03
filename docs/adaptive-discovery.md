# Adaptive Discover recommendations

Discover renders the existing catalog-backed discovery feed between its header and curated collections. Empty catalogs produce an honest empty state. No sample fallback is served.

## Persistent learner model

Onboarding selections remain the prior. Actual focus intervals, progress milestones with recorded focus time, saves, session starts, questions, exercise/review completions and dismissals project into the existing `userConceptAffinity` table. Opens have zero learning evidence. Seek position alone does not imply consumption. Short abandonment contributes a weak negative signal.

Direct evidence uses `discovery-behavior-v2`; graph propagation uses `discovery-adjacent-v2` and cannot masquerade as observed learning. Each projection has a persistent activity-event idempotency marker. Updates and markers commit together. The Code Observer and Hint Ladder are unchanged.

Behavioral evidence decays with a 45-day half-life. Its ranking share grows continuously as evidence accumulates, capped at 92%. The onboarding prior ages over 180 days and retains a weak floor. Mastery, active goals, StudySession concepts and unfinished progress supply learning context.

## Existing discovery pipeline

Candidate retrieval combines quality catalog candidates, tracked and adjacent concepts, due-review concepts, unfinished resources and session resources. Accepted graph relations and canonical hierarchy provide adjacency. Ranking considers concept relevance, decayed affinity, prerequisite/mastery fit, level, format, duration, language, quality, available measured completion/retention priors, freshness and learning context. CTR is diagnostic and does not enter the score.

The six-video feed is reranked across channels, concepts, subtopics, difficulty, duration and format. One slot can explore a quality adjacent topic with suitable level. Completed resources are suppressed except an overdue review after seven days; dismissed resources remain excluded until explicitly restored. Exploration is deterministic per learner/resource.

Existing recommendation runs and candidates persist strategy/feature versions, final positions and reason codes. Run context snapshots retain candidate features, learner-model version and personalization weights. Impression/open/save/dismiss telemetry references the run; StudySession metadata carries run attribution into consumption and completion events.

## Stability and limits

Feed fingerprints include affinity, preferences, mastery, goals, session context, progress milestones, aged unacted impressions, a daily decay bucket and catalog state. Real behavior invalidates cached/durable runs; repeated clicks and unchanged progress heartbeats do not reshuffle them. Concurrent requests share a run.

Set `LEARNSPACE_ADAPTIVE_DISCOVERY_ENABLED=false` to hide and stop generating this Discover section. Other existing discovery APIs remain available.

Candidate retrieval is bounded (200 general and 600 personalized candidates per resource type, plus up to 100 unfinished resources). Question/exercise/review replay catches up at most 100 unprojected outcomes per request from the previous 90 days; larger backlogs should use the existing worker. Quality priors and learning outcomes are used only when genuinely available. This is a transparent heuristic learning-utility ranker; it does not claim a trained learning-gain model.

## Checks

`apps/web/tests/adaptive-discovery.test.ts` covers all requested cold-start, missing-interest, repeated/diverging-interest, abandonment, completion, rewatch, dismissal, adjacency, diversity, completed suppression, confidence transition, reason correctness and no-padding scenarios.

`adaptive-discovery.integration.test.ts` checks persistent snapshots/provenance, concurrent run reuse, click neutrality, actual consumption, duplicate intervals, feed invalidation, outcome replay and dismissal. `discover-feed.test.tsx` checks ordering, empty states, visible reasons, controls and absence of internal scores. Existing discovery, onboarding, StudySession and Home integration suites exercise the shared architecture.
