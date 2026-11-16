# Notes session latency

How long the Notes session takes to answer, where that time went, what changed, and how to reproduce every number here. No model, prompt or model setting changed: the same Silero, Parakeet Redux / Moonshine, Supertonic, tutor and scribe models run with the same weights, inputs and generation settings. What changed is everything around them.

## Results

Learner's last word → Luny's first sound, the latency a learner perceives, **timed end to end in one run**:
- **Device:** Luny's real hook, workers and models in headless Chromium, hearing a fake microphone.
- **Server:** the real sign-in check and voice turn, against a fresh local database with a fixed round trip added to every query.
- **Model:** a stand-in tutor, the only one. It takes 1080 ms to its first output (the real model's p50 in `agent.model_invocations`), then streams a token every 15 ms, identically before and after.

**Production runs at the 2 ms row.** Vercel serves the API from `bom1` (the `x-vercel-id` of `learn-space.app`'s API responses), and the database is Supabase's `ap-south-1` pooler. Both are in Mumbai, so a round trip is a few milliseconds. The 20 and 60 ms rows show what the server changes are worth if the app and the database are ever apart.

At that 2 ms, with everything shipped (the shorter first piece, change 13, included): **2782 → 1941 ms (−30%)** for two-sentence replies, and 1937 ms for one-sentence replies (40 turns, all transcripts correct; `e2e-opener.json`). Leaving out the model's 1080 ms, LearnSpace's own share goes 1702 → 861 ms (−49%). These runs came after the interleaved ones, on the same machine and database setup, so they were not interleaved with "before". The table below is the interleaved before/after run, without change 13. The A/B for change 13 alone is in its section: about −400 ms, measured against the code just before it.

Means over 20 turns per cell, before/after interleaved:

| Database round trip | Reply | Before | After | Change |
|---|---|---|---|---|
| 2 ms (co-located, as production) | two sentences | 2782 ms | 2304 ms | −17% |
| 20 ms | two sentences | 3631 ms | 2475 ms | −32% |
| 20 ms | one sentence | 3875 ms | 2596 ms | −33% |
| 60 ms | two sentences | 5299 ms | 2843 ms | −46% |

With the model's own 1080 ms taken out, what LearnSpace itself adds goes 1702 → 1224 ms (−28%) at 2 ms, 2551 → 1395 ms (−45%) at 20 ms and 4219 → 1763 ms (−58%) at 60 ms.

At 2 ms the server has little left to gain; what remains is the device:
- the 200 ms end-of-turn silence (unchanged on purpose);
- Moonshine writing the words down;
- Supertonic's first piece: about 670 ms for a whole first sentence, 220–340 ms once change 13 lets it be a short opener.

The model inference itself is ruled out by the goal. Shortening the 200 ms silence would change when Luny decides the learner has finished.

Transcripts: 3 of 80 turns were wrong before and 2 of 80 after. One of the two after is a sentence split at its comma pause, which the unchanged 200 ms rule allows either way. The earlier device-only runs had 0 of 120 wrong after the change.

Where the time goes, stage by stage (p50 for the server, means for the device; interleaved, before/after/before/after). Summed with the model's 1080 ms, these give 2816 → 2246 ms at 2 ms, 3567 → 2396 ms at 20 ms and 5257 → 2716 ms at 60 ms, within 5% of the timed runs above:

| Stage | Before | After | Change |
|---|---|---|---|
| Last word → words written down, on the device (multi / single) | 928 / 957 ms | 555 / 550 ms | −40% / −43% |
| Sign-in and onboarding check, server, 20 ms RTT | 267 ms | 24 ms | −91% |
| Request → model call, check included, 20 ms RTT | 955 ms | 194 ms | −80% |
| Request → model call, check included, 60 ms RTT | 2645 ms | 514 ms | −81% |
| Request → model call, check included, 2 ms RTT | 204 ms | 44 ms | −78% |
| Turn preparation alone (admission, reads, run), 20 ms RTT | 688 ms | 170 ms | −75% |
| Turn start → last sentence released to the voice, 20 ms RTT | 1505 ms | 714 ms | −53% |
| Scribe request → first edit on the page, 20 ms RTT | 2535 ms | 848 ms | −67% |
| Scribe request → notebook saved, 20 ms RTT | 2535 ms | 2049 ms | −19% |
| Luny's first sentence, words in hand → first sound (multi / single) | 604 / 913 ms | 567 / 576 ms | −6% / −37% |
| Notes editor main-thread time per scribe pass (120 blocks) | 64.3 ms | 22.8 ms | −65% |

The device numbers above come from runs where the benchmark holds Luny's reply back 1.25 s (`--reply-delay 1250`), standing in for the server and the model, as in use. Earlier runs answered instantly. That is a harsher case: her first sentence is synthesised while the listener's threads are still awake, so it took ~70 ms longer after the change (567 → 635 ms), though the turn was still faster overall (first sound 1362 → 1172 ms, mean). With a realistic gap, that penalty is gone. Both sets are kept (`client-{before,after}.json`, `client-delayed-{before,after}.json`).

## Where the time went (audit)

The pipeline: microphone → AudioWorklet (resample to 16 kHz) → Silero VAD (32 ms frames) → end of turn after 200 ms of silence → STT (Parakeet on WebGPU, else Moonshine on WASM) → `POST /voice` (admission, reads, model stream) → Supertonic TTS, a clause or sentence at a time → audio. Separately, after each exchange, the scribe pass rewrites the notes (`POST /notes/consolidate`) and the editor shows them.

Measured before any change:

- **Server, before the model was even called: 690 ms at 20 ms RTT.** drizzle sends every query through postgres.js `unsafe()`, which never prepares statements, so each bound query is a describe round trip and an execute round trip. A turn ran its admission checks, rate limits, reads and run bookkeeping as roughly 15 such queries in series, plus `set_config` per transaction. Latency scaled with RTT × statements, not with work.
- **Every request first spent ~13 round trips proving who was asking** (267 ms at 20 ms RTT, 749 ms at 60 ms), before any of the above:
  - `requireCompletedSession` read the session, then the user, then touched the session's last-seen time (a write sent even when it changed nothing), each a bound query;
  - then a whole transaction loaded the learner's onboarding state, including their chosen topics, only to check one timestamp.
- **The lesson's chunks were read from the database on every turn**, though a ready resource version is immutable.
- **Luny's last sentence waited for persistence.** Its release was tied to `done`, sent only after the transcript and the run were written (three more serial writes).
- **The scribe's edits appeared only when the whole JSON was written** and saved.
- **On the device, about 800 ms from last word to transcript**: the 200 ms end-of-turn silence, then Moonshine on one thread (it shared a worker, and so a single-thread setting, with Silero), with frames hopping through the page's main thread.
- **The editor replaced the whole document on each scribe pass**, so ProseMirror re-compared every block and redrew formulas and diagrams.

## Changes

### Server

1. **`set_config` and the admission lock in one round trip each** (`packages/db/src/client.ts`, `isUuid`; `apps/web/lib/tutor/limits.ts`). A UUID user id can only be its own literal, so these statements are sent as simple queries (one round trip) instead of bound ones (two). Any other id is still bound.
2. **Admission and the run as one statement** (`apps/web/lib/tutor/limits.ts`, `admitTutorRun`). Under the same advisory lock, one statement now fails stale pending messages, counts pending ones, reads today's spend and units, and inserts the turn's `agent_runs` row only if every check passed. The busy, daily-limit and capacity errors are raised in the same order as before, and a refused turn records no run. The two rate-limit windows are consumed in parallel.
3. **Parallel lanes for a turn** (`prepareTurn` in `apps/web/lib/notes/service.ts`). Rate limits, the notebook and lesson read, the conversation read and admission-with-run each run in their own transaction on separate pool connections. The read lanes hand their rows over as soon as they have them and commit behind; the conversation read starts on the lesson's id while the lesson read is still finding the video (`masteryRecord` takes it as a promise). The run's transaction commits only after every lane succeeded, so a failed read rolls the run back and leaves nothing executing (asserted in the integration test). A failure is reported in the same order as before (admission → read → conversation → run). The benchmark runs at the production pool size (10).
4. **Lesson chunks cached** per user and resource version (LRU, 64 entries), safe because ready versions are content-addressed and immutable; empty reads are not cached.
5. **Luny's reply released before it is saved.** As soon as the model finishes, the server sends `{type:"say", text:"", final:true}`, which releases her last sentence. The transcript and run writes then go out in parallel, and `done` follows.
6. **Streaming scribe edits.** The scribe's JSON is parsed as it streams (`partial-json`). Each completed op is validated with `noteOpSchema` and sent as NDJSON (`{type:"op"}`), then the saved notebook (`{type:"notes"}`). The page shows the ops as a preview (`applyNoteOps`) until the saved notebook replaces it. The run's close and the notebook lock now run in parallel.

7. **The sign-in check in one round trip** (`findSessionWithOnboarding` in `apps/web/lib/auth/repository.ts`, used by `requireCompletedSession`). One statement joins the session, its user and the user's settings row. The auth role already reads all three; its `user_settings` policy is `USING (true)`.
   - The token's SHA-256 hex digest and the time go in as literals, so the statement has no parameters and is sent as a simple query.
   - The `LIMIT 1` went too, because drizzle binds it. A token is 256 random bits, so its hash names one session at most.
   - The last-seen touch is skipped when the session was seen in the last four minutes. The statement still checks the five-minute rule against the database's clock, so the minute's margin covers clock skew.
   - The same errors come out: a missing, expired, revoked or inactive session is 401; missing settings is `ONBOARDING_SETTINGS_MISSING` (500); unfinished onboarding is `ONBOARDING_REQUIRED` (403).
   - Every route behind `requireCompletedSession` gains this, not only Notes. `findSessionByToken` (sign-in elsewhere) is one statement as well.

Not done, by design: prepared statements and query pipelining. Production reaches Postgres through Supabase's transaction pooler (port 6543), which does not keep prepared statements across transactions, and pipelining through it is unsafe. Fewer statements, simple-protocol queries where values are literals, and parallel transactions get the round trips down without either.

### On the device

8. **Silero in a worker of its own** (`components/study/voice/vad.worker.ts`, endpointing in `vad.ts`). The microphone worklet posts frames straight to it over a `MessagePort`, transferred, never through the page. Each frame carries its capture time, so turns are timed from when the audio was heard. Utterances go to the listener over a second port. The endpointing constants (thresholds, 200 ms end of turn, 320 ms barge-in, padding) are unchanged.
9. **Moonshine on ONNX Runtime's default thread pool.** With frame-by-frame work out of its worker, the listener is idle between utterances, so it no longer needs one thread. Parakeet stays on one thread, the setting its speed check was calibrated on.
10. **Speculative transcription.** At 96 ms of silence (3 frames), the utterance so far goes to the listener, which starts writing it down. At 200 ms the turn's end confirms that guess, by which time the words are mostly written. If speech resumes, the guess is dropped and stopped at its next token (`InterruptableStoppingCriteria` for Moonshine, a stop check in Parakeet's decode loop), and the utterance carries on. Every message carries a reset epoch, so audio from before a reset is dropped everywhere.
11. **The editor patches only what changed** (`replaceChanged` in `components/study/notes-diff.ts`). `Fragment.findDiffStart`/`findDiffEnd` bound the changed stretch, and only that is replaced. Blocks before and after keep their nodes, views and rendered formulas. If the patched document isn't exactly the saved one, the whole document is replaced instead (fuzz-tested over 400 random edits).

12. **No 404s from the prefetch.** It asked transformers.js for Silero's files with the defaults, which also probe for a tokenizer and a processor that Silero doesn't have. That logged two 404s on every visit, and the discovery e2e spec (no browser errors on Home) failed. It now asks for the model's own files.
13. **Luny's first piece ends at her first clause** (`chunkEnd` in `components/study/useLunaVoice.ts`). A reply's first piece already could end at a clause mark (`,` `;` `:` `—`), but only one at least 12 characters in. Short openers ("Right —", "Exactly,", "Okay,") were never cut there, so Supertonic waited for the whole first sentence. The minimum is now 4 characters: an opener is voiced while the rest of the sentence is still being synthesised. A mark in the first few letters ("No, it's…") still doesn't split. Later pieces are whole sentences, as before, and the text, voice and model are unchanged.
   - **Measured against the code just before it** (2 ms round trip, end to end as in Results, interleaved, two runs of 10 turns each way): first sound averaged 2139–2370 ms with the 12-character rule and 1811–1996 ms with 4, about −400 ms. Words in hand → first sound went from 570–710 ms to 220–340 ms.
   - **No gap from the split.** In instrumented A/B runs (40 turns each way), the next piece was always ready before the first finished playing: a gap of 0 ms in every turn.
   - **Chunk boundaries never changed what was heard.** All transcripts in the short-opener runs were correct.

### Investigated and rejected, with the measurements that decided it

- **Silero sharing transformers.js's ONNX Runtime in a third worker.** This was the first version of change 8. It made the first three turns slower to first audio (2.0–2.4 s against 1.3 s). A Chrome trace showed why: `wasm.TopTierCompilation` keeps two thread-pool threads busy for 20–40 s after load. A third instance of transformers.js's 27 MB WASM module makes V8 compile its optimised tier. The old pipeline plus one idle worker that only loads Silero reproduces it, and loading that worker last doesn't help. Running Silero on ORT's plain 14 MB build removes it: same runtime version and CPU kernels, so the same scores, but a different binary.
- **Silero back in the listener worker.** ORT web shares one thread pool per worker, so Silero's 31 runs a second kept Moonshine's four threads spinning (three cores at 100%). Neither `intraOpNumThreads: 1` nor `allow_spinning: "0"` changed that, so the spinning option is not used anywhere.
- **Single-thread Moonshine** costs ~180 ms of heard latency. **A fuller TTS warm-up** cut the early-turn penalty but added 2.3 s to load. **Dynamic-tiering flags** made it worse.
- **Rust/WASM rewrites.** The costly work is model inference, already C++ compiled to WASM SIMD by ONNX Runtime. The JavaScript around it (endpointing, resampling) takes microseconds per frame. Profiling found time in database round trips, inference and V8 compilation, never in that JavaScript. Another WASM module would add exactly the compile cost found above.

## Compatibility and behaviour notes

- **Pages loaded before this change keep working.** The final `say` has empty text, which old pages speak as nothing. The scribe route streams only when asked (`Accept: application/x-ndjson`); any other caller gets the saved notebook as JSON, as before.
- **A guess's audio ends 96 ms into the silence**, where the utterance used to run on through the whole 200 ms. Only silence is cut, and the transcripts were identical.
- **The hour rate-limit window now also counts requests the minute window rejects**, because both are consumed at once instead of the hour only after the minute passed.
- **First use downloads ORT's plain WASM build (14 MB)** for Silero's worker. The prefetch stores it in the models' cache at low priority, beside the other model files, and later visits read it from there. Load time in a fresh profile: 6.7–6.9 s before; 6.6–7.9 s in the A/B runs after, and 6.8 s once the runtime's cache write stopped blocking its start.
- **Moonshine uses up to four cores while it writes a turn down**, then idles. The threads compete with Luny's voice only when her reply arrives within a few hundred milliseconds of the transcript (the benchmark's instant reply). There, her first sentence takes ~70 ms longer. With the server and model in between, it doesn't (see Results).
- **`identity.auth_sessions.refresh_token_hash` is now indexed** (migration `0039_session_token_index`, `auth_sessions_refresh_token_hash_idx`). Every request finds its session by that hash, and before, it scanned the table. On 100,000 sessions the lookup took 11.9 ms as a scan and 0.03 ms with the index (`EXPLAIN ANALYZE` on a synthetic table). It is a plain `CREATE INDEX`, which locks writes to the table while it builds. That is brief at today's size, but on a much larger table it would be worth building `CONCURRENTLY` by hand first.

## Reproducing

From `apps/web`, against the local Docker Postgres only (the root `.env.production` is production; the server benchmark refuses non-local databases):

```sh
# Server: a proxy adds each round trip; the model is a stand-in with fixed timings, so only LearnSpace's work varies.
# Each turn first passes the sign-in check from a real session token (gateMs), as a request does.
DATABASE_URL=postgres://learnspace_app:learnspace_app@localhost:55432/learnspace \
DATABASE_MIGRATOR_URL=postgres://learnspace_migrator:learnspace_migrator@localhost:55432/learnspace \
DATABASE_AUTH_URL=postgres://learnspace_auth:learnspace_auth@localhost:55432/learnspace \
  pnpm exec tsx --tsconfig tsconfig.test.json scripts/benchmark-notes-latency.ts --rtt 2,20,60 --turns 12 --out server.json

# Device: headless Chromium, the real models from the local transformers.js cache, a fake microphone (espeak-ng + ffmpeg).
node scripts/benchmark-notes-client.mjs --only voice --turns 10 --scenarios multi,single --reply-delay 1250 --out voice.json
node scripts/benchmark-notes-client.mjs --only voice --turns 10 --scenarios multi,single --out voice-instant.json
node scripts/benchmark-notes-client.mjs --only editor --out editor.json

# End to end: both of the above at once, the real server against the database (use a fresh one: see below).
pnpm exec tsx --tsconfig tsconfig.test.json scripts/benchmark-notes-client.mjs --server real --rtt 20 --turns 10 --only voice --scenarios multi,single --out e2e.json
```

The "before" numbers are from the code as it was at the start of this work, measured on the same machine, interleaved with the "after" runs (before, after, before, after) because background load varies. Results are in `docs/benchmarks/notes/` (`e2e-{before,after}.json`, `e2e-opener.json` for the shipped code at 2 ms, `server-{before,after}.json`, `client-delayed-{before,after}.json`, `client-{before,after}.json` for instant replies and the editor). For the server's "before", every server file this work changed is swapped back to its original, including `packages/db/src/client.ts`, and `@learnspace/db` is rebuilt. Headless Chromium has no WebGPU adapter, so the device numbers are Moonshine's; Parakeet devices get the same VAD, speculation and server changes. `BENCH_DEBUG=1` prints the page's console; `BENCH_CHROME_FLAGS` passes Chromium flags (the tiering experiments).

## Regression results

- **Static checks.**
  - Typecheck is clean in every package.
  - Biome reports no errors and no new warnings in the files this work touched.
  - `@learnspace/db` is consumed from `dist/` at runtime, so run `pnpm --filter @learnspace/db build` after changing it.
- **`@learnspace/web` suite against local Postgres, worker running: 131 pass, 1 skipped.**
  - Two failed: the discovery integration test and the mastery test. Both pass with the worker paused and Redis up (below); the mastery test passes 12 of 12 that way.
  - `tests/close-cache.mjs` also shows as a failure: it is the helper file that `--test-force-exit` ends, not a test.
- **`@learnspace/shared`: 32 of 32.** Its `voiceTurnRequestSchema` fixture predated `watchedFromMs` (earlier work on this branch) and was brought up to date.
- **New and extended tests.**
  - `tests/notes.integration.test.ts`:
    - streamed scribe previews;
    - the final `say` before `done`;
    - stale and busy admission in the single statement;
    - no run left `executing`, and none recorded for another learner.
  - `tests/auth.integration.test.ts`:
    - the one-statement lookup, with onboarding unfinished, finished and settings missing;
    - an inactive user;
    - the last-seen touch, skipped when fresh and written when stale.
  - `tests/voice.test.ts`:
    - the endpointer (guess, confirm, drop, replace, blips, barge-in while Luny talks, reset);
    - `replaceChanged` fuzz;
    - where Luny's pieces end, the reply streamed in a letter at a time (an opener alone, no split in the first few letters, whole sentences after).
  - Migration `0039_session_token_index`: `db:check` is clean, and it applies and verifies (`db:migrate`, `db:verify`) on a fresh database.
- **Playwright e2e, as CI runs it: 26 of 26 pass.**
  - The setup: a production build (`NEXT_DIST_DIR=.next-e2e pnpm run build`, kept apart from the running dev container's `.next`), then `node tests/e2e/run.mjs --production --grep-invert "visual regression"`.
  - The database: a fresh one, as in CI. It ran in a throwaway container with the repo's init scripts, `db:migrate`, `db:verify` and `db:seed:dev`, plus Redis on 56379.
  - The notes spec's fake workers speak the three-worker protocol (Silero's `speech`, the listener's `final` with its epoch).
  - Two cleanups were fixed (`home-fixture.ts`, `source-discovery.spec.ts`). They failed on the `study.video_notes` foreign key, because the lesson guide now writes a notes row for any video a learner opens, which they didn't delete.
  - Under `next dev`, the discovery spec's "meaningful learning…" test fails by design. `lib/discovery/candidates.ts` shows test resources to the dev server in test mode, and the test checks that production hides them.
- **Visual-regression specs (`test:e2e:visual`, not part of CI) fail on this branch, unrelated to this work.**
  - Their baselines are from 2026-10-03, 38 commits back, and differ on the landing and auth pages, which this work doesn't touch.
  - The `/app` cases wait for `networkidle`, which never comes while the speech-model prefetch (already on `main`) downloads in the background.
  - Updating the baselines is a design decision, so they were left.
- **On the shared dev database (55432), the local Docker worker interferes; CI has no such worker.** Earlier failures blamed on "local data" were this.
  - **What it does:** `learnspace-backend-1` refreshes YouTube metadata, sees the tests' fake video IDs as unavailable and archives them mid-test (`services/worker/src/youtube-metrics.ts`). It also embeds test chunks, which breaks their cleanup.
  - **What it caused:** Study E2E A's 404 on start, the notes and tutor `afterAll` failures, the discovery integration test and a mastery-test flake.
  - **Workaround:** pause it for test runs, or use a fresh database as above.
- **One race fixed in a test.** The mastery test's early "write ahead" now waits for that check to finish writing, through the same `keepAlive` hook its other calls use; it read the check as still `writing` about one run in eight. 0 failures in 12 runs after the fix.
