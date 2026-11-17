import type { LessonControl } from "@learnspace/shared/notes";

/** Luny's playback commands, written inline in her speech as [[...]] and never spoken (see TALKER_INSTRUCTIONS). */
const SEEK = /^seek\s+(?:(\d+):)?(\d{1,2}):(\d{2})$|^seek\s+(\d+)$/;
const PAPER_PAGE = /^page\s+(\d{1,4})$/;
const PAPER_SECTION = /^section\s+([a-z0-9][a-z0-9-]{0,199})$/i;
const PAPER_HIGHLIGHT = /^highlight\s+(\d{1,2})$/;
const PAPER_REFERENCE = /^reference\s+(\d{1,4})$/;

type Passage = { chunkId: string; anchor: { page: number; sectionId: string } };

/**
 * The control a command asks for, or null for one to ignore ([[listen]] among them). A paper highlight names a passage by
 * its number in this turn's evidence, so it can only point at a passage the model was shown.
 */
export function parseCommand(command: string, passages: Passage[] = []): LessonControl | null {
  const text = command.split(/\s+/).filter(Boolean).join(" ");
  const seek = SEEK.exec(text);
  if (seek) {
    const [, hours, minutes, seconds, plain] = seek;
    const total = plain !== undefined ? Number(plain) : Number(hours ?? 0) * 3_600 + Number(minutes) * 60 + Number(seconds);
    return { seekMs: Math.min(total * 1_000, 86_400_000), playback: null };
  }
  if (text === "pause" || text === "play") return { seekMs: null, playback: text };
  const page = PAPER_PAGE.exec(text);
  if (page) return { page: Number(page[1]) };
  const section = PAPER_SECTION.exec(text);
  if (section) return { sectionId: section[1] };
  const highlight = PAPER_HIGHLIGHT.exec(text);
  const passage = highlight ? passages[Number(highlight[1]) - 1] : undefined;
  if (passage) return { chunkId: passage.chunkId, page: passage.anchor.page, sectionId: passage.anchor.sectionId, highlight: true };
  const reference = PAPER_REFERENCE.exec(text);
  if (reference && Number(reference[1]) > 0) return { reference: Number(reference[1]) };
  return null;
}

/**
 * Splits streamed reply text, from `from` on, into what can be spoken now and the commands that are complete. Text that may
 * still turn out to be a command (an unclosed "[[", or a "[" at the very end) waits for more; `final` releases it.
 */
export function splitReply(text: string, from: number, final: boolean): { say: string; commands: string[]; next: number } {
  let say = "";
  const commands: string[] = [];
  let at = from;
  while (at < text.length) {
    const open = text.indexOf("[[", at);
    if (open < 0) {
      const end = !final && text.endsWith("[") ? text.length - 1 : text.length;
      say += text.slice(at, end);
      at = end;
      break;
    }
    say += text.slice(at, open);
    const close = text.indexOf("]]", open + 2);
    if (close < 0) {
      at = final ? text.length : open;
      break;
    }
    commands.push(text.slice(open + 2, close));
    at = close + 2;
  }
  return { say, commands, next: at };
}

const WORD = /[a-z0-9']+/g;
const words = (text: string) => text.toLowerCase().match(WORD) ?? [];

/**
 * Whether a transcript is most likely the lesson playing nearby, picked up by the learner's microphone: the video is
 * playing and nearly every word is in what the lesson says around their place. Captions lag or lead the audio, so the
 * window is generous.
 */
export function isLecture(heard: string, chunks: { startMs: number | null; content: string }[], positionMs: number | null, playing: boolean): boolean {
  const said = words(heard);
  if (!playing || positionMs === null || !said.length) return false;
  const nearby = new Set(chunks.filter((chunk) => chunk.startMs !== null && chunk.startMs >= positionMs - 40_000 && chunk.startMs <= positionMs + 15_000).flatMap((chunk) => words(chunk.content)));
  if (!nearby.size) return false;
  return said.filter((word) => nearby.has(word)).length / said.length >= (said.length >= 4 ? 0.7 : 1);
}

