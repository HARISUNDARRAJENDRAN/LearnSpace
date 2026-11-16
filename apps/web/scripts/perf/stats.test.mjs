import assert from "node:assert/strict";
import { test } from "node:test";
import { summary, successfulTurns } from "./stats.mjs";

test("nearest-rank quantiles exclude missing metrics and require 100 samples for p99", () => {
  assert.deepEqual(summary([4, 1, 3, 2, null, NaN]), { n: 4, p50: 2, p95: 4, p99: null });
  assert.deepEqual(summary([]), { n: 0, p50: null, p95: null, p99: null });
  assert.deepEqual(summary(Array.from({ length: 100 }, (_, i) => i + 1)), { n: 100, p50: 50, p95: 95, p99: 99 });
});

test("provider failures and fast rate-limit errors cannot improve tutor latency", () => {
  const samples = [
    { status: 429, messageStatus: null, totalMs: 8 },
    { status: 200, messageStatus: null, totalMs: 10, failure: { code: "provider_unreachable" } },
    { status: 200, messageStatus: "completed", totalMs: 5000 },
  ];
  assert.deepEqual(summary(successfulTurns(samples).map((sample) => sample.totalMs)), { n: 1, p50: 5000, p95: 5000, p99: null });
});
