// The page the client benchmark loads: Luny's real voice hook (the same workers and models the app ships) and the real
// notes editor, with nothing else of the app around them. See ../benchmark-notes-client.mjs.
import type { NoteBlock } from "@learnspace/shared/notes";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { NotesEditor } from "../../components/study/NotesEditor";
import { useLunaVoice } from "../../components/study/useLunaVoice";

type Bench = { scenario: string };
const bench = (window as unknown as { __bench: Bench }).__bench;

function Voice() {
  const voice = useLunaVoice({
    sessionId: bench.scenario,
    lesson: () => ({ positionMs: 60_000, playing: false }),
    capture: () => null,
    onControl: () => undefined,
    onTurn: () => undefined,
    onExchange: () => undefined,
  });
  useEffect(() => { (window as unknown as { __voice: unknown }).__voice = voice; });
  return <p id="state">{voice.state}</p>;
}

const TEXT = [
  "The gradient $\\nabla L$ points uphill, so each step moves the weights against it by the **learning rate** $\\eta$.",
  "A rate that is too large overshoots the minimum and the loss can grow: $w \\leftarrow w - \\eta \\nabla L(w)$.",
  "Momentum keeps a running average of past steps, which smooths the path through narrow valleys.",
  "Watch [12:34] again for the worked example with `lr=0.1` and $\\eta^2$ terms.",
];
const block = (index: number, rev: number, by: "luna" | "you" = "luna"): NoteBlock => ({
  id: `b${index}`, type: index % 12 === 0 ? "heading" : index % 5 === 0 ? "bullet" : "paragraph", text: TEXT[index % TEXT.length] ?? "", done: false, by, rev,
});

function Editor() {
  const [page, setPage] = useState<{ blocks: NoteBlock[]; revision: number }>(() => ({ blocks: Array.from({ length: 120 }, (_, index) => block(index, 1)), revision: 1 }));
  useEffect(() => {
    (window as unknown as { __editor: unknown }).__editor = {
      // The scribe's pass lands: `count` new blocks after the sixth, and the first block reworded.
      scribe: (count: number) => setPage((current) => {
        const revision = current.revision + 1;
        const fresh = Array.from({ length: count }, (_, index) => ({ ...block(1_000 + revision * 10 + index, revision), id: `n${revision}x${index}` }));
        const blocks = [...current.blocks.slice(0, 6), ...fresh, ...current.blocks.slice(6)];
        blocks[0] = { ...(blocks[0] as NoteBlock), text: `Reworded at revision ${revision}: ${TEXT[0]}`, rev: revision };
        return { blocks, revision };
      }),
      blocks: () => document.querySelectorAll(".notes-page > *").length,
    };
  }, []);
  return <NotesEditor blocks={page.blocks} revision={page.revision} onOps={() => undefined} onSeek={() => undefined} />;
}

createRoot(document.getElementById("root") as HTMLElement).render(bench.scenario === "editor" ? <Editor /> : <Voice />);
