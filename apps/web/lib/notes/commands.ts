import type { LessonControl } from "@learnspace/shared/notes";

/** Luny's playback commands, written inline in her speech as [[...]] and never spoken (see TALKER_INSTRUCTIONS). */
const SEEK = /^seek\s+(?:(\d+):)?(\d{1,2}):(\d{2})$|^seek\s+(\d+)$/;

/** The seek, play or pause a command asks for, or null for one to ignore ([[listen]] among them). */
export function parseCommand(command: string): LessonControl | null {
  const text = command.split(/\s+/).filter(Boolean).join(" ");
  const seek = SEEK.exec(text);
  if (seek) {
    const [, hours, minutes, seconds, plain] = seek;
    const total = plain !== undefined ? Number(plain) : Number(hours ?? 0) * 3_600 + Number(minutes) * 60 + Number(seconds);
    return { seekMs: Math.min(total * 1_000, 86_400_000), playback: null };
  }
  if (text === "pause" || text === "play") return { seekMs: null, playback: text };
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

