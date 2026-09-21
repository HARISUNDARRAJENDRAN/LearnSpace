import assert from "node:assert/strict";
import test from "node:test";
import { thumbnailStateAfterError } from "../components/home/YouTubeThumbnail";
import { youtubeThumbnailFallback, youtubeThumbnailSources } from "../lib/home/thumbnail";

test("YouTube thumbnail lifecycle moves A primary to A fallback, then resets to B primary", () => {
  const sourceA = youtubeThumbnailSources("dQw4w9WgXcQ");
  const sourceB = youtubeThumbnailSources("9bZkp7q19f0");
  assert.ok(sourceA && sourceB);
  assert.equal(thumbnailStateAfterError("primary", sourceA.primary, sourceA.fallback), "fallback");
  assert.equal(thumbnailStateAfterError("fallback", sourceA.primary, sourceA.fallback), "placeholder");
  assert.equal(thumbnailStateAfterError("primary", sourceB.primary, sourceB.fallback), "fallback");
  assert.notEqual(sourceB.primary, sourceA.fallback);
});

test("thumbnail helpers reject invalid metadata and derive the final fallback", () => {
  assert.equal(youtubeThumbnailSources("invalid"), null);
  assert.equal(youtubeThumbnailFallback("https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg"), "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  assert.equal(youtubeThumbnailFallback("/local/thumbnail.jpg"), null);
});
