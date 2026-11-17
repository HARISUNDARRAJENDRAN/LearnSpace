# Research retrieval benchmark

`queries.json` contains 40 hand-labeled searches across exact title, identifier, author, semantic, foundational, recent, comparative, prerequisite, and ambiguous categories. Expected arXiv IDs include verified titles and years.

Run the live comparison from `apps/web` after loading `EXA_API_KEY`:

```sh
pnpm exec tsx scripts/benchmark-research-retrieval.ts
```

Each query runs the legacy Exa search and the Exa-only retrieval client against Exa live, in sequence. `results.json` records per-query candidates, failures, latency, category metrics, and any legacy gold hits lost by Exa-only query shaping. Live latency varies with Exa's service health; this benchmark does not use response fixtures or warm-cache timings.

## Results

Measured live on 2026-11-16 over 40 query pairs. Full per-query candidates, errors, and category metrics are in [`results.json`](./results.json).

| Run | Recall@10 | nDCG@10 | Latency p50 / p95 | Failed queries |
| --- | ---: | ---: | ---: | ---: |
| Legacy Exa control, this run | 0.5062 | 0.4649 | 877 / 1,810 ms | 1 |
| Exa-only retrieval, this run | 0.5437 | 0.4772 | 883 / 4,006 ms | 2 |
| Previous hybrid, per prior brief | 0.5563 | 0.5141 | not reported | not reported |
| Earlier archived hybrid snapshot | 0.5313 | 0.4899 | 2,566 / 4,005 ms | not retained |

The first post-change run found a query-shaping regression: a descriptive “Foundational sequence-to-sequence…” request entered Exa's narrow seminal-only lane and lost its exact match. The lane now requires an explicit original/seminal/landmark request or a “foundational paper/work” phrase; the rerun restored that result. In the final run, Exa timed out on two exact-title searches and the legacy control timed out on one different exact-title search, so exact-title category metrics are incomplete. Exa-only beat this run's legacy control overall, but remained below the reported previous hybrid on recall and nDCG.

Recall@10 is the macro-average fraction of hand-labeled relevant arXiv IDs in the first 10. nDCG@10 uses binary relevance over those IDs. Identifier resolution measures the share of the four identifier queries with any labeled result in the first 10. Latency is p50/p95 wall-clock time across all 40 live calls for each path. The “previous hybrid” row comes from the task brief; its latency was not provided. The archived row is a separate earlier hybrid measurement retained by the pre-change results file.
