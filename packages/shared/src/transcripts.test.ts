import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSegments, parseJson3Captions, transcriptSubmissionSchema } from "./transcripts.js";

// Shaped like a real auto-caption body: word segments, line-break events, and a blank window event.
const json3 = {
  wireMagic: "pb3",
  events: [
    { tStartMs: 0, dDurationMs: 4000, id: 1, wpWinPosId: 1, wsWinStyleId: 1 },
    { tStartMs: 0, dDurationMs: 4000, wWinId: 1, segs: [{ utf8: "If you want" }, { utf8: " to learn", tOffsetMs: 640 }] },
    { tStartMs: 2010, dDurationMs: 1990, wWinId: 1, aAppend: 1, segs: [{ utf8: "\n" }] },
    { tStartMs: 4000, dDurationMs: 5300, wWinId: 1, segs: [{ utf8: "computer\nscience" }] },
  ],
};

test("json3 captions become trimmed segments without blank or line-break events", () => {
  assert.deepEqual(parseJson3Captions(json3), [[0, 4000, "If you want to learn"], [4000, 5300, "computer science"]]);
  assert.deepEqual(parseJson3Captions(null), []);
  assert.deepEqual(parseJson3Captions({ events: "nope" }), []);
});

test("normalizing is stable, so two downloads of one track compare equal", () => {
  const once = normalizeSegments([[0, 1, "  a \n b "], [5, 1, "   "]]);
  assert.deepEqual(once, [[0, 1, "a b"]]);
  assert.deepEqual(normalizeSegments(once), once);
});

test("submissions reject negative times, empty text and unknown fields", () => {
  assert.ok(transcriptSubmissionSchema.safeParse({ language: "en", segments: [[0, 10, "hi"]] }).success);
  assert.ok(!transcriptSubmissionSchema.safeParse({ language: "en", segments: [[-1, 10, "hi"]] }).success);
  assert.ok(!transcriptSubmissionSchema.safeParse({ language: "en", segments: [[0, 10, ""]] }).success);
  assert.ok(!transcriptSubmissionSchema.safeParse({ language: "en", segments: [], extra: 1 }).success);
});
