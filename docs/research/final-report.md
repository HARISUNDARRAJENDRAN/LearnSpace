# Research mode: final report

Shipped to production on 2026-11-17 as `6c134bd` on main (squash of `feat/research-mode`; CI green, 39 e2e passed). Production has migrations through 0048, the `discovery-worker` edge function v10, the code runner `1a8a016`, and the curriculum backfill (120 curriculum papers, 8 track collections). Papers are parsed on Vercel after the first open; a production smoke test parsed arXiv 1301.3781 in 26 s.

Status key: **Done** means it works end to end with real data and passing tests. **Partial** means it works, but a stated target is missed or a step is unverified. The reason is given in the row.

## Definition of Done

| Area | Status | Evidence | Gaps |
|---|---|---|---|
| Sidebar | Done | Find Papers and Saved Papers moved into Research Home search and Library `?view=papers`. App-shell visual baselines were regenerated after a diff review. | — |
| Research Home | Done | Recently saved, favourite authors and the recommendation feed, with Refine recommendations (topics, followed authors). Visual baselines at desktop, tablet and mobile (`research-home-*`). | — |
| Favourite authors | Done | Follow and unfollow persist (`PATCH /api/v1/research/authors/[authorId]`). Empty states are covered by the visual baselines. | — |
| Search isolation | Done | One policy is enforced at the API, UI and cache. `header-search.spec` covers rapid mode switches during in-flight requests (Workflow F, passing). | — |
| Research agent | Partial | Exa only, as decided on 2026-11-16. Over 40 labelled queries, Recall@10 is 0.5437 and nDCG@10 is 0.4772, against 0.5062 and 0.4649 for the legacy control ([benchmark](../benchmarks/research-retrieval/README.md)). | Below the earlier hybrid (0.5563 / 0.5141). p95 latency is 4,006 ms because of Exa timeouts on exact-title queries. |
| PDF parser | Done | The fork is vendored with a Node binding, and its provenance is pinned. On the five-paper corpus the research fast path runs p50 710 ms vs upstream 985 ms, and 509 vs 369 pages/s at concurrency 8 ([benchmark](../benchmarks/pdf-parser/README.md)). | The fast path needs trusted native-text metadata, so untrusted sources use standard detection. |
| Paper ingestion | Done | Passages are citation-aware, carry page bounding boxes (PDF user space, [contract](paper-contract.md)) and have provenance. References resolve from inline arXiv ids and DOIs, then Exa, at 44 of 86 on the measured paper. A re-run of ingestion deletes stale references (migration 0048). | 42 references remain unresolved and are shown as plain text. |
| Research sessions | Done | Papers open on the Learning Canvas with a PDF reader (outline, paging, zoom, links, citation highlight boxes) and a Focus mode. Workflows A and B pass. The reader keeps the restored place across fit-to-width and early section jumps (fixed in 86ee3e7). | — |
| AI chatbot | Done | The scientific tutor offers depth levels, claim types, multi-paper reasoning and verifiable page citations that open the passage box. Model schemas are walked by strict-schema tests. | The tutor occasionally emits `*italic*` markdown. |
| Notes | Done | A–H paper notebooks that you can edit, that persist, and that Luny keeps up to date. Covered by Workflows A–C. | — |
| Voice | Partial | Luny voice is reused with paper context and the selection. Paper retrieval p95 is 35 ms (target ≤250 ms). Server first text is under 1 s with the fixed stand-in model. Workflow C passes, including an interruption. | First audio is 1,692 ms p50 and 2,481 ms p95 against a ≤1.5 s target. The floor is about 1,080 ms of model time-to-first-token plus about 600 ms on the client. A pre-recorded acknowledgement would close the gap; that decision is open. |
| Coding | Done | One eligibility policy covers videos and papers. The CPU exercise planner has a feasibility gate. Workflow D runs a solution in the sandbox and gets it accepted, and Workflow E confirms GPU papers have no Code tool. | Workflow D skips itself where no runner is configured (CI has none). |
| Learn nested sessions | Done | Code is hidden until the server answers, and never shows for ineligible lessons. `study.spec` asserts Code is absent in the session and its nested session (Workflow G). | — |
| Project guidance | Done | A guide with a worked example, a sandbox-computed explorer, edge cases, toy-to-full mapping, a project and a GPU reproduction plan. It is generated live in about 60 s; Workflow E passes. | — |
| Discover | Done | Curriculum pathways with prerequisite ordering; tracks start as courses of verified papers. Workflow A starts at Discover. | — |
| Library | Done | The papers view shows saves and resume at the page and percent, and it is user-scoped. Workflow A and `study.spec` cover it. | — |
| Performance | Partial | Measured on a production build ([report](../benchmarks/perf/README.md)): paper-session JS −37% (2.37 MB → 1.49 MB), paper-session cold p50 367 → 276 ms, Library research cold p50 435 → 250 ms, and the video session route 1.47 MB → 0.60 MB. DB queries are all ≤16 ms. | Research Home cold p50 rose from 716 to 906 ms on a shared, noisy desktop (n=10). No backend or model speedup is claimed. |
| Security | Partial | A manual review of code, infrastructure, the agent and the browser ([audit](../security/audit.md)). Fixed: PDF.js CVE-2026-16633, loopback-only ports, a required random runner token, and security headers. `security.spec` passes. | The Codex Security standard and deep scans could not run (no unprivileged namespaces on this host). The runner keeps host Docker-socket access. Live credentials appeared in a delegate's local log and should be rotated. |
| Regression | Done | `study` (4), `notes` (5), `tutor` (3), `header-search` (1) and `security` (2) specs pass. Lint is clean across all packages and the web typecheck is clean. The unit and integration tests for the changed files pass, run file by file. | The full unit and integration suite was not re-run after the last commit. |
| Delivery | Done | Workflows A–G are in `tests/e2e/research.spec.ts` (7 passed, run twice) and the existing specs. Visual baselines exist for the Research pages. The docs are under `docs/research`, `docs/benchmarks` and `docs/security`. | See below. |

## Known issues and open decisions

- **Stale visual baselines from main.** The `landing-hero`, `home-populated` and `login` baselines date from 2026-10-03 and predate main's redesign of those screens. This branch doesn't touch them, and CI excludes visual tests. Regenerate them on main after a review.
- **Mock model and the plan observer.** The e2e mock model doesn't answer the plan observer's prompt, so the observer logs a ZodError and carries on. This was already the case before this branch.
- **Open decisions:** the voice acknowledgement for first audio ≤1.5 s, and PDF upload storage.
- **Production data:** one pre-existing catalog row has a malformed arXiv ID (`1503.0806`) and was left unrepaired by the backfill.
- **Local data:** the "How models reason" paper set (`5e7a0000-…0001`) remains in the local database as a demo collection. Removing it means deleting the test user's course sessions across about 20 history tables.
