# LearnSpace application performance

Kept four lazy imports for unopened paper-session study tools. Initial paper-session JavaScript fell from 2,368,879 to 1,492,620 bytes (37.0%); cold shell-ready p50/p95 changed from 367.49/599.87 ms to 275.95/529.52 ms. No backend or model speedup is claimed.

## Method and environment

All page and HTTP measurements use an optimized Next.js 16.4.5 production build on the host and `next start` at `127.0.0.1:3100`. The Docker development server at port 3000 remains untouched. Builds use the Docker web container's environment, remap only local database hosts to port 55432, disable external KV, and use a separate `.next-perf` directory. No production database, deployment, migration, commit, package addition, or model swap is involved.

The host is an Intel i5-1135G7 (8 logical CPUs), 16,492,498,944 bytes RAM, Node 26.13.1, Linux 7.2.15-arch1-1, Chromium 151.0.7922.34. Production Node has a 3 GiB heap limit. The 1.5 GiB Docker web limit does not apply to the host production server. This is a shared desktop, without CPU or network isolation; latency changes are indicative and not causal proof. Exact free RAM, revisions, build IDs, raw samples, timestamps, and dirty paths are in the JSON files.

- Page cold: a fresh browser context with authentication only; HTTP cache and browser storage start empty. Server, operating-system, Postgres, and upstream-provider caches are **not** flushed.
- Page warm: immediate repeat navigation in the same context. Page readiness is the load event plus the main landmark, **not** PDF readiness. The separate reader flow waits for the real PDF text layer.
- Search suggestions: input change through a successful response and a rendered matching option, including the existing debounce. Research source search records the first response, first nonempty candidate set, and completion after run polling at one-second intervals.
- API cold: fresh request context / first query or turn, as specified in each supplementary report. This does not simulate a process restart per request.
- Latencies use nearest-rank p50/p95; p99 is null below 100 observations. A p95 from ten runs is the slowest sample. Raw samples are retained. Failed tutor turns and HTTP 429 responses are excluded from successful-latency quantiles and counted separately.
- CWV uses PerformanceObserver for LCP, CLS session windows, and Event Timing with a scripted keyboard/zoom interaction. INP is a laboratory proxy; events below Chromium's 16 ms threshold are unobserved, not zero. Observations last 600 ms after load plus the interaction. Late PDF content and field INP are not fully captured.
- Bytes and requests come from Resource Timing. Per-route JS is the on-disk uncompressed size of observed Next chunks; total build JS is all top-level static JS chunks. Cross-origin resources without timing permission can report zero transfer bytes. These are not gzip bundle estimates or an exhaustive route manifest.
- Browser memory is sampled with CDP over ten minutes while opening Notes, AI, Check, and Guide, scrolling the reader, and submitting a chat every two minutes. No forced GC is used, so endpoint heap growth alone is not a leak diagnosis. Server RSS and CPU come from `/proc`, with CPU normalized to one logical core.
- Voice-server probes use the existing fixed stand-in model (300 ms first output) to isolate application overhead. They do not demonstrate live-provider latency or a model speedup. The separate voice-client probe uses real cached on-device audio models and a fixed 1,080 ms server reply delay.

## Reproduce

Run from the repository root; use `rtk` for shell commands. Stop the port-3100 server between builds, and leave port 3000 alone.

```sh
rtk node apps/web/scripts/perf/production.mjs build
rtk node apps/web/scripts/perf/production.mjs start
# In another terminal, use the PID of that Next server, not the wrapper process.
rtk env PERF_SERVER_PID=<next-server-pid> node apps/web/scripts/perf/run.mjs --phase baseline --iterations 10
rtk node apps/web/scripts/perf/flows.mjs --phase baseline --only reader --iterations 5
rtk node apps/web/scripts/perf/flows.mjs --phase baseline --only panels --iterations 5
rtk node apps/web/scripts/perf/flows.mjs --phase baseline --only read --iterations 10
rtk node apps/web/scripts/perf/flows.mjs --phase baseline --only source --iterations 5
rtk node apps/web/scripts/perf/flows.mjs --phase baseline --only tutor --iterations 2
rtk env PERF_SERVER_PID=<next-server-pid> node apps/web/scripts/perf/run.mjs --phase baseline --only memory --seconds 600 --out /tmp/learnspace-perf/baseline-memory.json
rtk node apps/web/scripts/perf/production.mjs exec node scripts/perf/database.mjs /tmp/learnspace-perf/database.json
rtk node apps/web/scripts/perf/production.mjs exec ./node_modules/.bin/tsx --tsconfig tsconfig.test.json scripts/benchmark-notes-latency.ts --rtt 0 --turns 10 --out /tmp/learnspace-perf/baseline-voice-video.json
rtk node apps/web/scripts/perf/production.mjs exec ./node_modules/.bin/tsx --tsconfig tsconfig.test.json scripts/benchmark-notes-latency.ts --paper e5a565d3-380c-467b-8876-48b247628885 --rtt 0 --turns 10 --out /tmp/learnspace-perf/baseline-voice-paper.json
# From apps/web:
rtk node scripts/benchmark-notes-client.mjs --only editor --out /tmp/learnspace-perf/baseline-editor.json
rtk node scripts/benchmark-notes-client.mjs --only voice --turns 2 --scenarios single --reply-delay 1080 --out /tmp/learnspace-perf/baseline-voice-client.json
# From the repository root, after all samples finish:
rtk node apps/web/scripts/perf/merge.mjs baseline
rtk node --test apps/web/scripts/perf/stats.test.mjs
```

Repeat with `final` after the optimization. Do not run two builds or the two primary page suites concurrently. `--only pages|search` and `--routes paper-session` support narrower rechecks. Screenshots and intermediate artifacts go to `/tmp/learnspace-perf`; the JSON deliverables embed supplementary results. The benchmarks use a local test learner and create activity, source-search runs, and tutor messages; voice fixture users/resources are removed afterward. They never erase existing notes.

## Results

All latency tables below use **p50 / p95 / p99 (n)** in milliseconds. A dash means unmeasured, not zero. Page sample counts are ten per cache state; most supplementary flows have five or ten samples, and live tutor/audio samples are much smaller. No latency flow reaches 100 samples, so no measured latency p99 is available.

Control build: `XzDdOALGvyyajYC9jWPn2`, 2026-11-16T15:03:21.922Z; final build: `jln3VZEp9zo34kVN5o7bx`, 2026-11-16T15:12:22.005Z. Both normal production builds passed. The earlier interrupted build was retained in scratch and its missing flows were filled. The matched frontend control was rebuilt before the optimized build. The baseline ten-minute memory trace retains its original build ID `MsvT_b1DeFhZtLiX4KHI5`; it is descriptive rather than a matched memory A/B.

### Page and interaction latency

| Flow | Cache | Baseline p50/p95/p99 (n) | Final p50/p95/p99 (n) |
| --- | --- | --- | --- |
| research-home | cold | 716.24 / 1,066.21 / — (n=10) | 905.72 / 1,122.71 / — (n=10) |
| research-home | warm | 745.89 / 1,124.72 / — (n=10) | 832.31 / 1,274.1 / — (n=10) |
| learn-home | cold | 406.4 / 502.3 / — (n=10) | 452.85 / 779.93 / — (n=10) |
| learn-home | warm | 263.34 / 326.44 / — (n=10) | 291.77 / 701.68 / — (n=10) |
| library-learn | cold | 250.8 / 504.98 / — (n=10) | 235.62 / 324.76 / — (n=10) |
| library-learn | warm | 119.86 / 231.06 / — (n=10) | 112.08 / 213.77 / — (n=10) |
| library-research | cold | 434.61 / 676.08 / — (n=10) | 249.93 / 343 / — (n=10) |
| library-research | warm | 268.61 / 492.9 / — (n=10) | 137.08 / 181.89 / — (n=10) |
| research-discover | cold | 294.89 / 1,216.58 / — (n=10) | 290.72 / 555.39 / — (n=10) |
| research-discover | warm | 174.26 / 529.79 / — (n=10) | 139.92 / 250.22 / — (n=10) |
| paper-session | cold | 367.49 / 599.87 / — (n=10) | 275.95 / 529.52 / — (n=10) |
| paper-session | warm | 320.54 / 574.72 / — (n=10) | 212.96 / 619.31 / — (n=10) |
| research-track | cold | 233.42 / 384.94 / — (n=10) | 246.14 / 329.38 / — (n=10) |
| research-track | warm | 142.52 / 214.65 / — (n=10) | 140.15 / 191.86 / — (n=10) |

Page readiness above is the HTML/main-shell flow. The paper reader below waits for a rendered PDF text layer. The measured paper is *Energy-Based Reasoners: Your Recurrent Reasoner Should Be an Energy-Based Model*, resource `e5a565d3-380c-467b-8876-48b247628885`, session `e29b96ef-03f4-4f81-8479-9685bdc6d1c0`; its real 22-page PDF loaded.

| Flow | Cache | Baseline | Final |
| --- | --- | --- | --- |
| learn search suggestions | cold | 581.22 / 634.66 / — (n=10) | 660.55 / 864.04 / — (n=10) |
| learn search suggestions | warm | 284.7 / 329.67 / — (n=10) | 301.64 / 330.27 / — (n=10) |
| research search suggestions | cold | 390.87 / 614.97 / — (n=10) | 389.25 / 535.95 / — (n=10) |
| research search suggestions | warm | 277.41 / 685.53 / — (n=10) | 281.81 / 317.21 / — (n=10) |
| paper-reader | cold | 2,233.53 / 4,069.87 / — (n=5) | 2,509.6 / 3,096.35 / — (n=5) |
| paper-reader | warm | 715.97 / 1,805.2 / — (n=5) | 912.92 / 1,353.58 / — (n=5) |
| paper-content | cold | 28.9 / 56.3 / — (n=10) | 29.57 / 37.3 / — (n=10) |
| paper-content | warm | 27.56 / 44.04 / — (n=10) | 29.1 / 40.46 / — (n=10) |
| notes-load | cold | 17.19 / 26.52 / — (n=10) | 15.59 / 21.21 / — (n=10) |
| notes-load | warm | 15.55 / 21.05 / — (n=10) | 14.88 / 31.51 / — (n=10) |
| session-data | cold | 50.57 / 62.26 / — (n=10) | 51.67 / 89.22 / — (n=10) |
| session-data | warm | 48.01 / 61.54 / — (n=10) | 47.04 / 103.12 / — (n=10) |
| sidebar-sessions | cold | 16.65 / 24.4 / — (n=10) | 15.35 / 30.79 / — (n=10) |
| sidebar-sessions | warm | 16.36 / 21.96 / — (n=10) | 15.21 / 23.01 / — (n=10) |
| panel-Notes | cold | 560.15 / 801.38 / — (n=5) | 1,067.45 / 1,503.64 / — (n=5) |
| panel-Notes | warm | 393.96 / 473.26 / — (n=5) | 482.23 / 550.09 / — (n=5) |
| panel-AI | cold | 332.53 / 438.47 / — (n=5) | 458.53 / 504.08 / — (n=5) |
| panel-AI | warm | 364.13 / 403.58 / — (n=5) | 516.51 / 586.39 / — (n=5) |
| panel-Check | cold | 374.77 / 518.11 / — (n=5) | 328.87 / 454.91 / — (n=5) |
| panel-Check | warm | 347.44 / 370.18 / — (n=5) | 366.83 / 424.46 / — (n=5) |
| panel-Guide | cold | 395.66 / 561.28 / — (n=5) | 307.47 / 447.75 / — (n=5) |
| panel-Guide | warm | 361.92 / 454.24 / — (n=5) | 398.08 / 469.01 / — (n=5) |
| full-research-search first useful results | cold | 652.09 / 1,494.01 / — (n=5) | 1,206.1 / 1,916.62 / — (n=4) |
| full-research-search completion, including failures | cold | 652.1 / 1,494.02 / — (n=5) | 1,533.87 / 4,165.28 / — (n=5) |
| full-research-search first useful results | warm | 650.77 / 749.64 / — (n=5) | 752.98 / 1,444.7 / — (n=5) |
| full-research-search completion, including failures | warm | 650.78 / 749.64 / — (n=5) | 752.99 / 1,444.71 / — (n=5) |
| tutor-paper first block | cold | 6,898.13 / 7,340.2 / — (n=2) | 5,285.65 / 5,285.65 / — (n=1) |
| tutor-paper successful total | cold | 7,630.92 / 10,312.6 / — (n=2) | 8,802.72 / 8,802.72 / — (n=1) |
| tutor-paper first block | warm | 2,180.03 / 2,180.03 / — (n=1) | 2,652.52 / 2,652.52 / — (n=1) |
| tutor-paper successful total | warm | 3,021.71 / 3,021.71 / — (n=1) | 4,910.48 / 4,910.48 / — (n=1) |
| tutor-video first block | cold | 3,514.34 / 3,514.34 / — (n=1) | 4,512.93 / 4,512.93 / — (n=1) |
| tutor-video successful total | cold | 4,989.35 / 4,989.35 / — (n=1) | 10,882.22 / 10,882.22 / — (n=1) |
| tutor-video first block | warm | 3,279.35 / 3,279.35 / — (n=1) | 7,766.55 / 7,766.55 / — (n=1) |
| tutor-video successful total | warm | 4,567.86 / 4,567.86 / — (n=1) | 10,167.69 / 10,167.69 / — (n=1) |

Panel warm means reopening an already mounted panel, not a page reload. The raw panel-probe `readerMs` is the same pre-panel reader observation copied across tools; **only** the dedicated `reader` flow is used for cold/warm reader comparisons.

Baseline full-research-search: cold: 0 failures / 5 attempts; warm: 0 failures / 5 attempts. Useful candidate counts: {'cold': [18, 16, 24, 10, 23], 'warm': [18, 16, 24, 10, 23]}. 
Baseline tutor-paper: cold: 0 failures / 2 attempts; warm: 1 failures / 2 attempts. 
Baseline tutor-video: cold: 1 failures / 2 attempts; warm: 1 failures / 2 attempts. 
Final full-research-search: cold: 1 failures / 5 attempts; warm: 0 failures / 5 attempts. Useful candidate counts: {'cold': [0, 16, 24, 14, 23], 'warm': [18, 16, 24, 14, 23]}. 
Final tutor-paper: cold: 0 failures / 1 attempts; warm: 0 failures / 1 attempts. 
Final tutor-video: cold: 0 failures / 1 attempts; warm: 0 failures / 1 attempts. 

The baseline live tutor had one paper provider error and two video HTTP 429 responses from the six-turn/minute burst limit. Successful timing summaries exclude these attempts. Source-search failures and provider diagnostics are retained in `database.sourceRuns` and the source raw samples. Retrieval was being edited concurrently by its owner; source/tutor deltas are observational.

### Core Web Vitals laboratory observations

Each cell is **baseline p50/p95 → final p50/p95**. INP includes its observed sample count; absent sub-16-ms events and early LCP finalization limit this probe. This is not field certification.

| Page | Cache | LCP ms | CLS | INP proxy ms | TTFB ms |
| --- | --- | --- | --- | --- | --- |
| research-home | cold | 970.52/1,292.27 → 1,120.2/1,343.32 | 0.0100/0.0100 → 0.0100/0.0100 | 24/64 → 24/72 (n=10→10) | 48.81/73.61 → 56.99/104.53 |
| research-home | warm | 981.8/1,326.66 → 1,070.68/1,503.09 | 0.0100/0.0100 → 0.0100/0.0100 | 24/56 → 24/152 (n=9→9) | 44.44/69.97 → 50.22/71.92 |
| learn-home | cold | 292.4/339.51 → 308.86/462.27 | 0.0000/0.0000 → 0.0000/0.0000 | 64/112 → 72/112 (n=10→9) | 50.83/83.87 → 52.49/87.95 |
| learn-home | warm | 194.58/257.38 → 226.38/567.79 | 0.0000/0.0000 → 0.0000/0.0000 | 64/88 → 80/208 (n=10→10) | 52.56/84.95 → 65.43/232.08 |
| library-learn | cold | 446.99/619.23 → 425.7/471.74 | 0.0100/0.0100 → 0.0100/0.0100 | 32/48 → 24/32 (n=9→9) | 38.26/130.37 → 32.98/46.41 |
| library-learn | warm | 335.4/459.81 → 330.18/398.26 | 0.0000/0.0000 → 0.0000/0.0000 | 16/24 → 16/32 (n=8→9) | 32.64/98.73 → 31.95/59.58 |
| library-research | cold | 539.13/776.71 → 440.21/520.95 | 0.0100/0.0100 → 0.0100/0.0100 | 32/64 → 16/24 (n=10→9) | 75.28/218.65 → 37.09/59.56 |
| library-research | warm | 475.84/654.21 → 358.28/422.55 | 0.0000/0.0000 → 0.0000/0.0000 | 24/48 → 24/32 (n=9→9) | 72.19/222.54 → 37.43/49.82 |
| research-discover | cold | 461.3/1,489.08 → 447.52/666.29 | 0.0100/0.0100 → 0.0100/0.0100 | 32/104 → 16/40 (n=9→10) | 40.29/175.76 → 43.87/132.9 |
| research-discover | warm | 352.44/618.91 → 360.9/461.59 | 0.0000/0.0000 → 0.0000/0.0000 | 24/56 → 24/32 (n=10→9) | 49.34/154.16 → 38.9/86.95 |
| paper-session | cold | 609.64/843.9 → 464.88/711.15 | 0.0529/0.0536 → 0.0529/0.0533 | 16/24 → 16/16 (n=3→1) | 50.3/86.2 → 36.55/93.17 |
| paper-session | warm | 599.83/917.6 → 461.31/936.66 | 0.0528/0.0530 → 0.0527/0.0528 | —/— → —/— (n=0→0) | 55.28/101.09 → 39.48/138.2 |
| research-track | cold | 436.63/564.25 → 438.56/528.82 | 0.0100/0.0100 → 0.0100/0.0100 | 24/32 → 16/32 (n=9→10) | 34.81/57.48 → 31.61/42.02 |
| research-track | warm | 358.26/421.94 → 359.95/403.39 | 0.0000/0.0000 → 0.0000/0.0000 | 16/32 → 16/32 (n=9→10) | 34.7/51.27 → 34.29/48.18 |


### Bundle, transfer, and requests

| Route | Initial JS before, B | After, B | Delta | Cold transfer median, B | Warm transfer median, B | Cold request median | Warm request median |
| --- | --- | --- | --- | --- | --- | --- | --- |
| research-home | 690,129 | 690,335 | +0.03% | 895,275 → 895,919 | 151,535 → 151,512 | 68 → 69 | 68 → 69 |
| learn-home | 1,954,119 | 1,954,817 | +0.04% | 1,186,252 → 1,189,975 | 48,351 → 48,494 | 41 → 46 | 41 → 46 |
| library-learn | 1,931,752 | 1,932,450 | +0.04% | 1,151,752 → 1,155,461 | 20,980 → 21,127 | 38 → 43 | 38 → 43 |
| library-research | 1,931,752 | 1,932,450 | +0.04% | 1,172,209 → 1,175,890 | 41,428 → 41,547 | 47 → 52 | 47 → 52 |
| research-discover | 683,052 | 683,258 | +0.03% | 785,153 → 785,814 | 44,204 → 44,205 | 52 → 53 | 52 → 53 |
| paper-session | 2,368,879 | 1,492,620 | -36.99% | 1,883,896 → 1,619,162 | 234,844 → 241,060 | 51 → 53 | 51 → 53 |
| research-track | 683,052 | 683,258 | +0.03% | 801,681 → 802,365 | 60,735 → 60,193 | 52 → 53 | 52 → 52 |

Total build JS bytes: **3,423,925 → 3,465,388**. Code splitting postpones downloads; it does not remove editor functionality. The current test learner has a video session, so Learn and Library route observations include prefetched study code and are larger than the interrupted run's earlier measurements. They remain unchanged within approximately one kilobyte in the matched comparison.

Paper cold long-task total: 354/471 → 112/254 ms p50/p95. Warm paper p95 shell readiness was 574.72 → 619.31 ms; that tail did not improve in the primary run.

### Voice, scribe, and editor

The server voice and scribe model timings are fixed controls, and their raw model usage is synthetic. Cold is one connection-cold turn/pass; warm is ten voice turns or five scribe passes. The audio probe uses a fake microphone playing real synthesized speech through cached on-device models, not a physical microphone.

| Flow | Cache/group | Baseline | Final |
| --- | --- | --- | --- |
| video voice first text | cold | 352.16 / 352.16 / — (n=1) | 418.4 / 418.4 / — (n=1) |
| video voice first text | warm | 311 / 322 / — (n=10) | 348 / 426 / — (n=10) |
| video voice total | cold | 628.36 / 628.36 / — (n=1) | 856.33 / 856.33 / — (n=1) |
| video voice total | warm | 576 / 587 / — (n=10) | 681 / 733 / — (n=10) |
| video scribe first edit | cold | 715.53 / 715.53 / — (n=1) | 777.51 / 777.51 / — (n=1) |
| video scribe first edit | warm | 712 / 715 / — (n=5) | 734 / 770 / — (n=5) |
| video scribe saved | cold | 1,681.64 / 1,681.64 / — (n=1) | 1,886.03 / 1,886.03 / — (n=1) |
| video scribe saved | warm | 1,637 / 1,658 / — (n=5) | 1,667 / 1,764 / — (n=5) |
| paper voice first text | cold | 448.38 / 448.38 / — (n=1) | 607.94 / 607.94 / — (n=1) |
| paper voice first text | warm | 354 / 377 / — (n=10) | 363 / 456 / — (n=10) |
| paper voice total | cold | 707.33 / 707.33 / — (n=1) | 898.67 / 898.67 / — (n=1) |
| paper voice total | warm | 613 / 644 / — (n=10) | 631 / 769 / — (n=10) |
| paper scribe first edit | cold | 761.81 / 761.81 / — (n=1) | 747.67 / 747.67 / — (n=1) |
| paper scribe first edit | warm | 752 / 769 / — (n=5) | 748 / 778 / — (n=5) |
| paper scribe saved | cold | 1,697.46 / 1,697.46 / — (n=1) | 1,677.38 / 1,677.38 / — (n=1) |
| paper scribe saved | warm | 1,695 / 1,721 / — (n=5) | 1,679 / 1,722 / — (n=5) |
| paper voice retrieval | cold | 22 / 22 / — (n=1) | 31 / 31 / — (n=1) |
| paper voice retrieval | warm | 9 / 14 / — (n=10) | 11 / 35 / — (n=10) |
| editor task busy time | cold | 93.6 / 93.6 / — (n=1) | 269.8 / 269.8 / — (n=1) |
| editor task busy time | warm | 22.3 / 39.7 / — (n=9) | 38.9 / 120 / — (n=9) |
| on-device client heardMs | loaded models / 2 turns | 467 / 728 / — (n=2) | 380 / 687 / — (n=2) |
| on-device client firstWordsMs | loaded models / 2 turns | 1,554 / 1,814 / — (n=2) | 1,465 / 1,772 / — (n=2) |
| on-device client firstAudioMs | loaded models / 2 turns | 1,794 / 2,058 / — (n=2) | 1,692 / 2,481 / — (n=2) |

Paper retrieval stays below the 250 ms p95 target on this local corpus; its recorded metric excludes retrieval-run persistence. Fixed-model server first text stays below one second, which does not establish the live model target. **First audio misses the 1.5-second target in both runs**. Client startup/model load was 8,682 → 16,079 ms even with cached model files. One final ASR utterance was mistranscribed; two artificial turns are insufficient to establish quality or barge-in behavior.

### Paper ingestion and database investigation

Three existing worker-produced ready versions carry download/parse/chunk/resolve/embed/total timings. These are historical per-paper observations, **not** repeated cold/warm trials or a before/after ingestion optimization. No worker code was edited.

| Stage | Stored p50/p95/p99 (n) |
| --- | --- |
| downloadMs | 1,748 / 1,782 / — (n=3) |
| parseMs | 511 / 678 / — (n=3) |
| chunkMs | 4 / 7 / — (n=3) |
| resolveMs | 4,288 / 43,416 / — (n=3) |
| embedMs | 8,925 / 11,689 / — (n=3) |
| totalMs | 18,248 / 54,248 / — (n=3) |


| Representative RLS query | Control EXPLAIN execution ms | Final observation ms |
| --- | --- | --- |
| search-learn | 8.03 | 7.26 |
| search-research | 11.73 | 16.06 |
| research-home | 3.89 | 6.22 |
| research-discover | 0.14 | 0.13 |
| research-library | 0.11 | 0.1 |
| paper-content | 0.07 | 0.08 |
| paper-passages | 0.7 | 0.58 |
| paper-voice-retrieval | 1.19 | 1.1 |
| video-tutor-retrieval | 0.43 | 0.76 |
| notes-load | 0.03 | 0.05 |
| sidebar-sessions | 0.11 | 0.16 |

Plans include buffers, actual rows, and index/scan nodes in each JSON file. The catalogue held 1921 resources and 4589 chunks at the control observation. Queries were milliseconds on this dataset; no speculative index, migration, or pooling change was retained. This is a representative query-shape audit, not an exhaustive SQL trace, production concurrency test, or proof that no N+1 exists. Discover uses a representative three-paper ID set. The Learn Library loader was exercised end to end but not separately EXPLAINed.
Historical prompt/cache observations (not isolated live test calls; include fixture/model tests):

| Purpose | Calls | Calls with cached tokens | Input / cached / output tokens |
| --- | --- | --- | --- |
| paper_tutor:medium | 2 | 0 | 7331 / 0 / 1256 |
| paper_tutor:none | 16 | 15 | 194889 / 53108 / 3590 |
| video_tutor:high | 32 | 18 | 232666 / 37328 / 22382 |
| video_tutor:medium | 2 | 1 | 9208 / 1500 / 3212 |
| video_tutor:none | 28 | 18 | 151673 / 51947 / 13931 |
| voice_notes:guide:low | 24 | 10 | 397495 / 13496 / 143958 |
| voice_notes:none | 164 | 158 | 468210 / 329752 / 10487 |
| voice_notes:scribe:low | 40 | 31 | 384244 / 193290 / 2641 |
| voice_notes:scribe:medium | 57 | 14 | 293033 / 25356 / 18911 |
| voice_notes:talk:none | 123 | 105 | 937189 / 552239 / 5762 |

No prompt prefix, reasoning depth, provider, model, external timeout, or answer policy was changed.

### Ten-minute memory and server utilization

| Run | Requested seconds | Samples | JS heap MiB first→last | Peak heap MiB | Peak server RSS MiB | CPU %, p50/p95/p99 (n) | Actions | Panel-action errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | 600 | 108 | 22.99 → 45.95 | 46.05 | 426.28 | 0 / 28.97 / 56 (n=602) | {'Notes': 108, 'AI': 108, 'Check': 108, 'Guide': 108, 'chat': 5} | 0 |
| Final | 600 | 103 | 22.73 → 40.45 | 51.87 | 351.66 | 0 / 6.01 / 38.88 (n=600) | {'Notes': 103, 'AI': 103, 'Check': 103, 'Guide': 103, 'chat': 5} | 0 |

The primary page-suite server RSS/CPU distributions are separately stored as `serverSummary`. Heap includes the intentionally retained mounted panels and accumulating chat messages. No forced-GC retained-heap analysis or physical-device memory measurement was made, and the memory baseline came from the inherited production build. Consequently, these traces do not establish an improvement or absence of a leak. Action counts record chat submissions, not verified successful model replies. Supplementary probes sometimes overlap the memory run and can affect its CPU/heap trajectory.

## Optimization decisions and regression checks

| Candidate | Decision | Evidence and reason |
| --- | --- | --- |
| Lazy-load Notes, Check, Code and Guide in PaperSession | **Kept** as one code-splitting change | Initial route JS 2,368,879 → 1,492,620 bytes (−876,259 bytes, −37.0%); cold shell p50/p95 367.49/599.87 → 275.95/529.52 ms; cold long-task p50 354 → 112 ms. Existing opened-panel state keeps mounted editors alive. The existing LoadingState announces chunk loading. No per-module ablation is claimed. |
| Lazy-load Notes, Check and Code in VideoSession (orchestrator follow-up after this phase) | **Kept** | Same change as PaperSession, prompted by the Learn and Library prefetch weight above. The video study route's initial client JS, summed from the production build's client reference manifests, fell from 1,467,079 to 599,285 bytes (−59%) and now sits next to the paper route (614,165). Learn Home, Library and Research route entries are unchanged (282,560 / 260,193 / 246,117); their earlier 1.9 MB transfer was the sidebar prefetching this route. Notes, Check and Chat open in a real video session with no API errors. VideoSession also moved from the coding profile endpoint, which answered 403 for ineligible lessons, to the eligibility endpoint. Page latency for this change was not re-measured. |
| Lazy-load Chat as part of the prototype | **Removed before building/measuring** | The current opener focuses its input on the next animation frame. An asynchronous module could miss that focus. Chat remains eager; warm keyboard-focus assertions pass. There are no speed measurements for this discarded prototype. |
| Lazy-load PaperFocus | Not attempted | It has imperative citation/ref navigation; deferring it would require additional readiness logic. Its current behavior and refs are preserved. |
| Add indexes or change connection pools | Not attempted | Representative queries were roughly 0.03–12 ms in the control. A parallel supplementary probe exhausted the local database's **40** connection slots (53300); the same voice probe passed when rerun separately. That is not evidence for a production pool/index change. No other process's connections were terminated. |
| Rewrite PDF virtualization/rendering | Not attempted | The owned-by-another-agent reader already uses a worker and near-viewport rendering. The real PDF loaded in the dedicated reader flow. No reader rendering code was edited. |
| Change AI prompts, models, provider fan-out or retrieval | Not attempted | Model settings remained unchanged. Retrieval files were changing under their owner's work, and the final Attention query timed out once before its warm retry returned 18 candidates. No model/provider latency improvement is attributed to this phase. |

**The first-use cost is real.** Notes cold opener p50/p95 was 560.15/801.38 ms in the control and 1,067.45/1,503.64 ms in the primary final run. A separate five-context recheck measured **781.42/1,082.28 ms** cold and **412.05/449.45 ms** warm. The change is retained because an unopened editor is unnecessary for reading, removes 876 KB from every closed-panel opening, and pays the loading cost once per mounted session. It is not a universal latency improvement. These tradeoffs must remain visible to the reviewer.

The primary warm paper shell p95 increased from 574.72 to 619.31 ms. A separate ten-context recheck measured cold 259.45/458.14 ms and warm 169.49/304.69 ms p50/p95, so that tail regression was not reproduced. Research Home cold p50 was 716.24 → 905.72 ms in the primary comparison and 603.28 ms on recheck; Learn Home was 406.40 → 452.85 ms and 429.86 ms on recheck. Their observed JS changed by only 206 and 698 bytes respectively. Shared CPU, changing user history, and backend work prevent attributing those page deltas to this import-only change. Both the primary runs and rechecks are retained, rather than replacing the primary data with the fastest run.

The unchanged direct-editor benchmark measured 22.3 ms baseline and 38.9 ms primary-final median busy time. An after-memory followup measured 16.8 ms and a separately run followup measured **24.1 ms**. Every pass rebuilt zero existing blocks. This benchmark imports NotesEditor directly and bypasses the changed PaperSession parent, so it cannot measure a benefit from the new parent code splitting. All three final observations are embedded in final.json.

No subagents were delegated; there is no additional subagent diff to accept or revert.

## Screenshot and behavior verification

- Compared 1440×900 and 390×844 paper-session and Notes/AI/Check/Guide captures with ImageMagick and visual inspection. All captures and difference images remain outside the repository in `/tmp/learnspace-perf`.
- The primary closed-paper desktop comparison had **zero differing pixels**. Mobile Check and Guide also matched exactly.
- The primary mobile paper image differed because the baseline was still opening the PDF while final had rendered it. Desktop panel differences include a changed persisted reader page (benchmark scrolling), and Chat includes additional benchmark messages.
- Early Notes/AI mobile panel captures caught the sidebar transition at different positions; the settled recheck disables animations and waits after resizing. Its Notes layout was visually inspected. The orb is animated and notes show the existing headless microphone-start error in both baseline and final. These comparisons are not a blanket pixel-perfect visual test; the import-only application diff changes no CSS, layout markup or panel props.
- The final panel suite and its recheck assert that closing/reopening Notes preserves its actual DOM mount and that reopening Chat preserves keyboard focus. Both passed all five contexts.
- This paper was not eligible for Code, so its button did not appear. The Code dynamic import was compiled and typechecked, but its runtime opening/generation was not exercised with this fixture.

## Test and validation results

| Check | Actual result |
| --- | --- |
| Normal host production control build | Passed, including TypeScript and generating all 105 static build entries |
| Normal host optimized production build | Passed, including TypeScript and generating all 105 static build entries |
| Host `tsc --noEmit -p .` | Final two runs passed. An initial run had 19 diagnostics in the other owner's retrieval test/benchmark; those files were subsequently fixed by that owner. No errors were ignored in the final checks. |
| `node --test apps/web/scripts/perf/stats.test.mjs` | 2 passed: nearest-rank/missing-value/p99 guard, and fast rate-limit/provider failures excluded from successful tutor latency |
| Container `tests/research.test.ts` | 3 passed, 0 failed |
| Container `tests/notes.integration.test.ts` | 2 passed, 0 failed |
| Voice/notes service benchmark assertions | Baseline and final video + paper runs passed, including streamed replies, persisted scribe edits, citation-bearing paper operations and cleanup |
| Production Playwright flows | Seven page routes × ten cold/warm contexts; both search modes; five cold/warm reader contexts; read APIs; source search; live paper/video tutor probes; five panel contexts; two 600-second memory sessions completed |
| Panel behavioral assertions | Notes DOM mount preservation and warm Chat keyboard focus passed; no page module-loading errors in primary page samples |
| `node --check` on run/flows/database/merge scripts | Passed |
| Owned tracked-file `git diff --check` | Passed |
| Fixture cleanup regression | Added child retrieval-row cleanup before agent runs; interrupted-run fixtures were removed by exact IDs and assert-checked absent |

The earlier notes benchmark needed its mock scribe output updated to the current required citation field; an invalid mock reply initially failed its save assertion. The first paper run also exposed the missing retrieval foreign-key cleanup. Both were corrected in benchmark code and successfully rerun. A transient source-import failure occurred while retrieval files were being edited; retry succeeded without editing those files. One plan-observer model response logged a validation failure because `actions[0].searchQuery` exceeded 120 characters. Navigation also logged expected aborted PDF responses as contexts closed; no primary page sample recorded a browser JavaScript error.

The full project e2e runner was not started: the shared development server's app-directory lock makes its second Next dev server conflict. The dedicated production Playwright harness exercised this phase without stopping port 3000. No production deployment, external-account change, migration, dependency addition, commit or push was made. The temporary production server on port 3100 was stopped. Generated next-env imports were restored byte-for-byte to their pre-build development paths.

## Scope and attribution

The only retained application edit is the named-import replacement plus existing accessible loader in `apps/web/components/research/PaperSession.tsx`. That file was already an uncommitted new Research-mode component. Its remaining source was preserved; there is no API contract change. Every other retained edit belongs to measurement or reporting.

| File | Change in this phase |
| --- | --- |
| `apps/web/components/research/PaperSession.tsx` | Four module-scope Next dynamic imports and the existing LoadingState fallback; eager Chat preserved |
| `apps/web/scripts/benchmark-notes-latency.ts` | Paper turns, raw/cold/warm timings, p95/p99, current scribe citations, local-URL validation and percentile self-check |
| `apps/web/scripts/benchmark-notes-fixture.ts` | Delete benchmark retrieval children/runs before their agent runs during cleanup; existing callers retain the same interface |
| `apps/web/scripts/perf/production.mjs` | Continued the inherited local-production build/start/env wrapper unchanged |
| `apps/web/scripts/perf/run.mjs` | Continued harness; route/search selectors, rendered search-result check, closed-panel view reset, real zoom interaction, correct PDF-error selector, memory scrolling/chat submissions and failure metadata |
| `apps/web/scripts/perf/stats.mjs` | Successful tutor-turn filtering alongside inherited nearest-rank quantiles |
| `apps/web/scripts/perf/stats.test.mjs` | Failure-exclusion regression test alongside quantile coverage |
| `apps/web/scripts/perf/flows.mjs` | Real reader, APIs, source polling, tutor streaming, tool timings/screenshots and panel-state/focus assertions |
| `apps/web/scripts/perf/database.mjs` | Local app-role/RLS EXPLAIN probes, stage timing records, provider failure and historical token/cache observations |
| `apps/web/scripts/perf/merge.mjs` | Embed supplementary raw reports and rechecks, normalized quantiles/failures, CPU/RSS summaries and measurement limitations |
| `docs/benchmarks/perf/baseline.json` | Completed baseline, matched frontend control plus labeled inherited memory/other supplementary observations |
| `docs/benchmarks/perf/final.json` | Final samples and retained followups/rechecks |
| `docs/benchmarks/perf/README.md` | Method, reproduction, before/after tables, decisions, risks, checks and attribution |
| `apps/web/next-env.d.ts` | Temporarily regenerated by Next builds, then fully restored; no retained edit from this phase |

Source fingerprints between the frontend control snapshot and final build differed in PaperSession plus the separately owned `apps/web/lib/research/retrieval/service.ts` and `service.test.ts`. Those retrieval files, the paper reader, source-discovery implementation and worker were not edited here. The local database was not frozen: the paper-content payload grew from 179,715 to 185,807 bytes during the probes and reading/chat state changed. This further limits causal backend/reader comparisons. The earlier interrupted run's screenshots and JSON remain in scratch, not silently relabeled as the matched control.

## Remaining limits and followup observations

- The 1.5-second first-audio target remains unmet: p50/p95 was 1,794/2,058 ms before and 1,692/2,481 ms after, with a fixed 1,080 ms server reply delay. This phase did not change audio code or claim a voice speedup.
- Real-provider first voice text, full live paper end-to-end audio, physical microphones/speakers, barge-in, and uncached on-device model downloads were not measured by the existing fake-microphone/fixed-server client harness. Paper server retrieval/voice was measured separately.
- Field CWV/INP, React Profiler commit durations, production hardware/network, multi-user load, forced-GC retained-heap analysis, and fully cold DB/OS/upstream caches were not measured. Default production React does not provide the profiling-build commit callbacks, and no separate profiling build was used.
- Transfer/request totals cover initial page Performance entries. Worker-internal requests and opaque cross-origin traffic may be absent; this is not a complete session network capture. Parser/indexing cache-state comparisons are unavailable because only three stored per-stage worker observations were used.
- Paper Code runtime opening was unavailable for the selected fixture. Learn study tools were not restructured; the concurrently rewritten VideoSession still contributes substantial prefetched code to Learn/Library for this learner. That is a separate candidate requiring its own controlled change and measurements.
- Source search had one final cold Exa timeout, then succeeded on repeat. Retrieval/provider behavior is owned by the parallel task; preserve its quality and latency review separately.
- The plan-observer validation warning on an overlong model-generated search query should be investigated by its owner; it was outside this import-only optimization and did not break the page loads.
