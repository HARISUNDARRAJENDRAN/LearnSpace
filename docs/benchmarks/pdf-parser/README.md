# PDF parser benchmark

Run from the repository root:

```bash
python3 docs/benchmarks/pdf-parser/fetch-corpus.py
python3 docs/benchmarks/pdf-parser/run-bench.py --runs 24 --warmups 3 --upstream-ref 6bafce1bb7f195d13083d647c6a5899991745169
```

This run used fork `6845225193200a7779e69b2021e15fb1293b0adc` and upstream `6bafce1bb7f195d13083d647c6a5899991745169`. The upstream source and all release builds live in a temporary directory outside the repo. The run records resolved Cargo locks in `locks/` and machine-specific raw summaries in [`results/latest.json`](results/latest.json). The fetched PDFs stay under the ignored `corpus/` directory.

Environment: Linux x86_64, glibc 2.44, 8 CPUs; Python 3.14.10; Rust/Cargo 1.98.1. Each corpus latency includes one process startup per paper. Corpus latency is the sum over the five sequential parser processes in each of 24 measured rounds; p95/p99 use nearest-rank percentiles. RSS is the largest per-process peak within the five-paper round.

## Five-paper corpus

| Path | p50 (ms) | p95 (ms) | p99 (ms) | Pages/s at p50 | Median CPU (ms) | Max RSS (MiB) |
|---|---:|---:|---:|---:|---:|---:|
| Fork standard detector | 740.6 | 938.8 | 970.5 | 206.6 | 914.1 | 56.0 |
| Research fast path | 709.7 | 849.7 | 1996.9 | 215.6 | 881.4 | 56.0 |
| Upstream standard path | 985.0 | 1173.7 | 1331.0 | 155.3 | 1147.4 | 58.4 |

The fast path matches the fork's standard path byte-for-byte on all five papers. The current upstream parser differs byte-for-byte on all five; these are newer upstream extraction changes, not fast-path changes. The p99 fast-path result includes a single high-latency outlier, so the p50/p95 improvement should not be read as a tail-latency guarantee.

## Throughput

This repeats the same five PDFs five times (25 parser jobs) at each worker count, so concurrency 8 has eight runnable jobs.

| Path | Concurrency | Documents/s | Pages/s |
|---|---:|---:|---:|
| Fork standard detector | 1 | 7.46 | 228.2 |
| Fork standard detector | 4 | 16.31 | 499.1 |
| Fork standard detector | 8 | 14.62 | 447.4 |
| Research fast path | 1 | 7.53 | 230.3 |
| Research fast path | 4 | 16.62 | 508.5 |
| Research fast path | 8 | 16.64 | 509.3 |
| Upstream standard path | 1 | 5.33 | 163.0 |
| Upstream standard path | 4 | 12.47 | 381.6 |
| Upstream standard path | 8 | 12.07 | 369.3 |

## Extended corpus checks

- The 48-page reference-heavy survey and 76-page survey parsed as text-based. The 76-page paper had one OCR-needed page.
- The one-page image-only scan was classified `ImageBased` and marked for OCR by standard detection. Selecting the verified-native fast path for this scan reported `TextBased` while still marking the page for OCR; callers must use `source: "untrusted"` unless acquisition metadata actually guarantees native text.
- The two-column fixture parsed on all three paths.
- The truncated PDF was rejected as `Invalid PDF structure` on all three paths in all 24 measured attempts; no text was fabricated.
