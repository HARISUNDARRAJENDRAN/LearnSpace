# Home dashboard data audit

Home keeps its existing five-card layout. Analytics no longer use the hardcoded sample object or fabricated fallback values.

| Component | Previous source | Persisted source now | No / little activity | Established activity |
| --- | --- | --- | --- | --- |
| Learning Overview | Sample hours, active days, comparison and bars | User's `study.focus_sessions.duration_sec`, grouped by calendar day in their timezone | Quiet empty copy; first measured seconds and actual active days; no comparison without previous-week time | All-time study duration, actual week-over-week comparison, four calendar-week bars once two weeks have measured time |
| Weekly Progress | Sample percentages and segment sizes | Same measured intervals, partitioned by session mode; actual starts/completions from `study.user_resource_progress` | Empty copy, or actual resource counts before time exists; first seconds produce a real donut | Current week, previous week and calendar month; proportional Focus / Practice / Research segments |
| Study Distribution | Sample category shares and hours | Same measured intervals, partitioned into practice, video, paper/PDF and other study | No bubbles until time exists; only categories with measured time appear | Actual time shares and durations; each interval belongs to one category |
| Learning Activity & Progress Trends | Sample historical points and mixed-unit series | Same time intervals by session mode, plus actual first-start/completion counts | Lightweight empty copy until the selected period has two buckets with measured time | Last seven calendar days, up to twelve calendar months, or calendar years; genuine gaps are zero, not invented activity |
| Continue Watching | Already database-backed | User's active/paused study session, visible video metadata and persisted resource progress | Existing modest Discover link; a started unfinished video can appear before measured time exists | Actual resume route, thumbnail and persisted lesson progress; completed/deleted/inaccessible material excluded |

Continue Learning and Recent Activity are not present in the current Home layout; they have not been reintroduced. Continue Learning on Discover remains backed by persisted study progress, not dashboard fixtures. Home's summary metrics are covered above.

## First application entry

`identity.user_settings.first_application_visit_at` is a persistent, nullable timestamp. Completing registration/onboarding does not consume it. An atomic conditional update records the first actual app entry and routes it to `/app/discover`; subsequent sessions preserve normal destinations even with no activity. Server pages ignore prefetch requests. Existing completed accounts are marked as already entered by migration, so inactivity does not re-onboard returning users.

## Measurement and presentation

- Visible video playback and active, focused paper reading send short intervals to an authenticated, user-scoped endpoint. Pausing, hiding the page, leaving a resource or becoming idle stops measurement. Paper reading uses a 60-second interaction idle cutoff.
- Intervals are persisted in seconds. Retries reuse an interval ID; a per-user transaction lock and overlapping-interval union prevent double counting across tabs or out-of-order requests. Inputs, ownership, resource binding and recent timestamps are validated.
- `formatLearningDuration(seconds)` is shared by Home metrics, charts, axes, details and accessible labels: seconds below one minute, minutes below one hour, then hours and remaining minutes. No `0h` fallback.
- Daily projections currently have no writer, so Home reads measured intervals directly. Existing video positions are never converted into historical study time: seeking is not elapsed learning. Historical sessions without measured intervals remain uncounted.
- Test-only dashboard fixtures live under `tests/`; production loaders never import them.

## Checks

All 53 web tests and six targeted browser tests pass. Dashboard rendering/formatting tests cover empty, small and historical activity. Database integration checks cover account isolation, first-entry concurrency, timezone grouping, invalid intervals, retries and overlaps. Browser checks cover registration through onboarding, first entry, prefetch, subsequent sessions, real playback persistence, period controls, dialogs, keyboard/hover and touch interactions. TypeScript and targeted lint checks also pass; empty desktop and populated desktop/mobile screenshots were visually inspected.
