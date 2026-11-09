import { z } from "zod";

/** One caption line as [startMs, durationMs, text]; tuples keep a long lecture well under the request body limit. */
export const transcriptSegmentSchema = z.tuple([z.number().int().min(0), z.number().int().min(0), z.string().min(1).max(2_000)]);
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const transcriptSubmissionSchema = z.object({
  language: z.string().trim().min(2).max(16),
  segments: z.array(transcriptSegmentSchema).min(1).max(40_000),
}).strict();
export type TranscriptSubmission = z.infer<typeof transcriptSubmissionSchema>;

/** What the browser should do for a video: download captions from the signed URL, wait for one, or stop. */
export type TranscriptStatus =
  | { status: "ready" | "submitted" | "unavailable" }
  | { status: "queued" }
  | { status: "signed"; captionUrl: string; language: string };

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** Same captions in, same segments out, so two learners' downloads hash identically. */
export function normalizeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.flatMap(([startMs, durationMs, text]) => {
    const clean = collapse(text);
    return clean ? [[startMs, durationMs, clean] as TranscriptSegment] : [];
  });
}

type Json3 = { events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }> };

/** Parses YouTube's `fmt=json3` caption body into segments. */
export function parseJson3Captions(body: unknown): TranscriptSegment[] {
  const events = (body as Json3 | null)?.events;
  if (!Array.isArray(events)) return [];
  return normalizeSegments(events.flatMap((event) => {
    if (!event.segs || typeof event.tStartMs !== "number") return [];
    return [[Math.round(event.tStartMs), Math.round(event.dDurationMs ?? 0), event.segs.map((seg) => seg.utf8 ?? "").join("")] as TranscriptSegment];
  }));
}
