# Category curriculum intelligence

The Discover category sidebar explains the whole collection. It uses the same CSV-backed curriculum as the lesson list, including videos and playlists. Filtering or sorting the list does not change the category rationale.

`category-editorial.ts` contains domain-specific editorial judgments with required tracks, title fragments, creator information, and coverage notes. Claims about repeated treatments also require distinct resource URLs. A missing requirement removes its claim. Gap claims check the entire collection and describe missing *catalogue tracks*, not uninspected lesson content.

`category-intelligence.ts` first constructs resource roles, a topic map, evidence-backed observations, complementary relationships, overlap, trade-offs, and the suggested approach. It then compiles the visible prose from those observations. Additional tracks extend the explanation. Empty, single-resource, and insufficiently described categories receive a shorter deterministic explanation.

The current compiler is deterministic and editorial, with no LLM request. It does not invent clarity, mathematical depth, engagement, duration, or outcome claims that the curriculum does not support. The topic map reflects curation metadata rather than a transcript audit. A new category can use the conservative fallback until an editor supplies grounded observations.

## Persistence and updates

The server-only `lib/discovery/generated/category-intelligence.json` stores both analysis and final copy. The web build runs `discovery:generate:category-intelligence` before Next.js. To refresh it directly from `apps/web`:

```sh
pnpm discovery:generate:category-intelligence
```

Each fingerprint includes the compiler version, relevant category rules, resource membership and order, URLs, titles, creators, topic tracks, roles, stages, coverage notes, publication metadata, and language. It excludes thumbnails and CSV row IDs. Unchanged categories reuse their persisted result; unchanged output does not rewrite the artifact. Removed categories disappear from the artifact.

The runtime reuses persisted results and caches by category/fingerprint. A mismatch compiles a new deterministic result once per process. The existing curriculum loader treats the CSV as a deployment snapshot; deploy catalogue edits or restart the development process to reload it. There are no writable filesystem requirements or model calls on page requests.

The panel renders on the server and passes rendered content through the existing browser component. Internal evidence, the topic map, and fingerprints are not sent as client-component props. Mobile places it after the lesson list.

## Learner state

The core rationale is shared across learners. No Observer is invoked. Future personal next-step copy should consume the existing persistent concept affinities, mastery projections, and StudySession state as a separate insight. The Code Observer retains its exercise-diagnosis and Hint Ladder responsibility.

Focused checks cover every current category, evidence resolution, resource removal/replacement, missing metadata, repeated-topic safeguards, gap updates, fingerprint invalidation, cached stability, exploratory routes, escaped resource text, and the rendered panel. The existing Discover browser test checks that filtering leaves the category rationale unchanged.
