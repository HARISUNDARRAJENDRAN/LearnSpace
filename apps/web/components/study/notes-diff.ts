import type { NoteBlockType, NoteOp } from "@learnspace/shared/notes";
import type { Node } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

export type PageBlock = { id: string; type: NoteBlockType; text: string; done: boolean };
const op = (value: Partial<NoteOp> & Pick<NoteOp, "action" | "id">): NoteOp => ({ after: null, type: null, text: null, done: null, ...value });

/** The edits that turn the page as it was loaded into the page as the learner left it; empty blocks are not saved yet. */
export function diffBlocks(saved: PageBlock[], page: PageBlock[]): NoteOp[] {
  const local = page.filter((block) => block.text.trim());
  const kept = new Set(local.map((block) => block.id));
  const known = new Map(saved.map((block, index) => [block.id, { block, index }]));
  const ops: NoteOp[] = saved.filter((block) => !kept.has(block.id)).map((block) => op({ action: "delete", id: block.id }));
  // An op can only place a block after another (or last), so the page's first block stays put and anything saved before
  // it moves behind it; of the rest, the longest run already in saved order stays and every other block moves after the
  // block before it. A new first block means everything moves.
  const order = local.map((block) => known.get(block.id)?.index ?? -1);
  const first = order[0] ?? -1;
  const stay = new Set<number>();
  if (first >= 0) {
    stay.add(0);
    const tails: number[] = [], previous: number[] = [];
    order.forEach((value, at) => {
      if (at === 0 || value <= first) return;
      let low = 0, high = tails.length;
      while (low < high) { const mid = (low + high) >> 1; if ((order[tails[mid] ?? -1] ?? -1) < value) low = mid + 1; else high = mid; }
      previous[at] = tails[low - 1] ?? -1;
      tails[low] = at;
    });
    for (let at = tails.at(-1) ?? -1; at >= 0; at = previous[at] ?? -1) stay.add(at);
  }
  local.forEach((block, at) => {
    const after = local[at - 1]?.id ?? null;
    const old = known.get(block.id)?.block;
    if (!old) { ops.push(op({ action: "insert", id: block.id, after, type: block.type, text: block.text.trim(), done: block.done })); return; }
    if (!stay.has(at)) ops.push(op({ action: "move", id: block.id, after }));
    if (old.type !== block.type || old.text !== block.text.trim() || old.done !== block.done) {
      ops.push(op({ action: "update", id: block.id, type: old.type === block.type ? null : block.type, text: old.text === block.text.trim() ? null : block.text.trim(), done: old.done === block.done ? null : block.done }));
    }
  });
  return ops;
}

/**
 * Turns the page into `next` by replacing only the stretch that differs: the notes before and after it stay the very same
 * nodes, so the editor keeps their views, drawn formulas and diagrams instead of comparing and redrawing every note.
 */
export function replaceChanged(tr: Transaction, next: Node): Transaction {
  const doc = tr.doc;
  const from = doc.content.findDiffStart(next.content);
  if (from === null) return tr;
  const ends = doc.content.findDiffEnd(next.content) ?? { a: doc.content.size, b: next.content.size };
  // Where a run repeats (a note inserted beside its twin), the two ends can cross the start; both move back past it.
  const overlap = Math.max(0, from - Math.min(ends.a, ends.b));
  tr.replace(from, ends.a + overlap, next.slice(from, ends.b + overlap));
  // The page must end up exactly as saved; were the patch ever to land otherwise, the whole page is replaced instead.
  if (!tr.doc.eq(next)) tr.replaceWith(0, tr.doc.content.size, next.content);
  return tr;
}
