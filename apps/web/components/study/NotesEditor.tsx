"use client";

import type { NoteBlock, NoteBlockType, NoteOp } from "@learnspace/shared/notes";
import { Extension, InputRule, type JSONContent, Node } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorContent, NodeViewContent, type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import "katex/dist/katex.min.css";
import katex from "katex";
import { useEffect, useRef } from "react";
import { MATH } from "../../lib/math";
import { type MediaKind, NoteMedia } from "./NoteMedia";
import { diffBlocks, type PageBlock, replaceChanged } from "./notes-diff";

const MEDIA = new Set<NoteBlockType>(["diagram", "image", "link", "code", "table"]);
/** The label over each kind of callout in the study guide. */
export const CALLOUT: Partial<Record<NoteBlockType, string>> = { eli5: "In plain words", example: "Example", takeaway: "Key takeaway", aside: "Beyond the video" };
// **bold** and `code` in a note; math is found first, so neither is read inside a formula.
const MARKS = /(\*\*[^*\n]+?\*\*|`[^`\n]+?`)/;
const SAVE_AFTER_MS = 700;
const TIME = /\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]/g;
const newId = () => crypto.randomUUID().slice(0, 8);

function toDoc(blocks: NoteBlock[], revision: number): JSONContent {
  const content = blocks.map((block): JSONContent => {
    const attrs = { id: block.id, kind: block.type, done: block.done, by: block.by, fresh: block.by === "luna" && block.rev === revision };
    return MEDIA.has(block.type) ? { type: "noteMedia", attrs: { ...attrs, text: block.text } } : { type: "noteBlock", attrs, content: block.text ? [{ type: "text", text: block.text }] : [] };
  });
  return { type: "doc", content: content.length ? content : [{ type: "noteBlock", attrs: { id: newId(), kind: "paragraph" } }] };
}

const fromDoc = (doc: PMNode): PageBlock[] => {
  const blocks: PageBlock[] = [];
  doc.forEach((node) => { blocks.push({ id: node.attrs.id, type: node.attrs.kind, text: node.type.name === "noteMedia" ? node.attrs.text : node.textContent, done: node.attrs.done }); });
  return blocks;
};

const attribute = (value: unknown) => ({ default: value, rendered: false });

function BlockView({ node, updateAttributes }: NodeViewProps) {
  const { kind, fresh, done } = node.attrs as { kind: NoteBlockType; fresh: boolean; done: boolean };
  const callout = CALLOUT[kind];
  return <NodeViewWrapper className={`notes-block is-${kind}${callout ? " is-callout" : ""}${fresh ? " is-fresh" : ""}`}>
    {kind === "task" ? <input type="checkbox" contentEditable={false} checked={done} aria-label="Done" onChange={(event) => updateAttributes({ done: event.target.checked })} /> : null}
    {callout ? <span className="notes-callout-label" contentEditable={false}>{callout}</span> : null}
    {kind === "heading" ? <NodeViewContent<"h3"> as="h3" className="notes-block-text" />
      : kind === "subheading" ? <NodeViewContent<"h4"> as="h4" className="notes-block-text" />
      : <NodeViewContent<"p"> as="p" className="notes-block-text" />}
  </NodeViewWrapper>;
}

function MediaView({ node, updateAttributes }: NodeViewProps) {
  const { kind, text, fresh } = node.attrs as { kind: MediaKind; text: string; fresh: boolean };
  // A diagram is edited inside, so dragging in it moves its boxes, not the note.
  return <NodeViewWrapper className={`notes-block is-${kind}${fresh ? " is-fresh" : ""}`} data-drag-handle={kind === "diagram" ? undefined : ""}><NoteMedia type={kind} text={text} onChange={(next) => updateAttributes({ text: next })} /></NodeViewWrapper>;
}

const Doc = Node.create({ name: "doc", topNode: true, content: "(noteBlock | noteMedia)+" });

/** One note: its text, and as attributes the saved block's id, type, task state and who last wrote it. */
const NoteBlockNode = Node.create({
  name: "noteBlock",
  group: "block",
  content: "text*",
  defining: true,
  addAttributes: () => ({ id: attribute(null), kind: attribute("paragraph"), done: attribute(false), by: attribute("you"), fresh: attribute(false) }),
  parseHTML: () => [{ tag: "p" }, { tag: "h1" }, { tag: "h2" }, { tag: "h3" }, { tag: "li" }, { tag: "div[data-note]" }],
  renderHTML: () => ["div", { "data-note": "" }, 0],
  addNodeView: () => ReactNodeViewRenderer(BlockView),
  addKeyboardShortcuts: () => ({
    // Backspace at the start of a heading, task, bullet or quote makes it a plain paragraph first.
    Backspace: ({ editor }) => {
      const { $from, empty } = editor.state.selection;
      if (!empty || $from.parentOffset !== 0 || $from.parent.type.name !== "noteBlock" || $from.parent.attrs.kind === "paragraph") return false;
      return editor.commands.updateAttributes("noteBlock", { kind: "paragraph", done: false });
    },
  }),
  addInputRules() {
    const rule = (find: RegExp, kind: NoteBlockType) => new InputRule({
      find,
      handler: ({ state, range }) => {
        const $from = state.doc.resolve(range.from);
        if ($from.parent.type !== this.type) return;
        state.tr.delete(range.from, range.to).setNodeAttribute($from.before(), "kind", kind);
      },
    });
    return [rule(/^#{1,2}\s$/, "heading"), rule(/^#{3}\s$/, "subheading"), rule(/^[-*]\s$/, "bullet"), rule(/^1[.)]\s$/, "step"), rule(/^\[\s?\]\s$/, "task"), rule(/^\?\s$/, "question")];
  },
});

const NoteMediaNode = Node.create({
  name: "noteMedia",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ id: attribute(null), kind: attribute("link"), text: attribute(""), done: attribute(false), by: attribute("luna"), fresh: attribute(false) }),
  parseHTML: () => [{ tag: "div[data-note-media]" }],
  renderHTML: () => ["div", { "data-note-media": "" }],
  // The page leaves events inside a diagram or a source box to it: their drags, clicks and typing are their own.
  addNodeView: () => ReactNodeViewRenderer(MediaView, { stopEvent: ({ event }) => event.target instanceof Element && event.target.closest(".notes-diagram, .notes-source-edit, .notes-source-toggle") !== null }),
});

// Whether the page has the caret: a page that is only being read shows every note rendered.
const focusKey = new PluginKey<boolean>("notesFocus");

/** A formula drawn by KaTeX in place of its source. */
function formula(tex: string, display: boolean): HTMLElement {
  const element = document.createElement("span");
  element.className = display ? "notes-math is-display" : "notes-math";
  element.contentEditable = "false";
  katex.render(tex, element, { displayMode: display, throwOnError: false, output: "htmlAndMathml" });
  return element;
}

/**
 * Math, **bold** and `code` show rendered, with their source hidden, except in the note being edited, where the source
 * shows so it can be changed.
 */
function inlineDecorations(state: EditorState): Decoration[] {
  const found: Decoration[] = [];
  const { $from, $to } = state.selection;
  const focused = focusKey.getState(state) === true;
  const editing = focused && $from.depth > 0 ? $from.before(1) : -1;
  const editingTo = focused && $to.depth > 0 ? $to.before(1) : -1;
  state.doc.forEach((block, offset) => {
    if (block.type.name !== "noteBlock" || !block.textContent || (offset >= editing && offset <= editingTo)) return;
    const text = block.textContent;
    const start = offset + 1;
    let at = 0;
    text.split(MATH).forEach((part, index) => {
      const from = start + at;
      at += part.length;
      if (index % 2) {
        const display = part.startsWith("$$") || part.startsWith("\\[");
        const tex = part.startsWith("$") && !display ? part.slice(1, -1) : part.slice(2, -2);
        found.push(Decoration.inline(from, from + part.length, { class: "notes-source-hidden" }), Decoration.widget(from + part.length, () => formula(tex, display), { key: `${display}:${tex}`, side: -1, ignoreSelection: true }));
        return;
      }
      let within = 0;
      part.split(MARKS).forEach((piece, pieceIndex) => {
        const pieceFrom = from + within;
        within += piece.length;
        if (!(pieceIndex % 2)) return;
        const marker = piece.startsWith("**") ? 2 : 1;
        found.push(
          Decoration.inline(pieceFrom, pieceFrom + marker, { class: "notes-source-hidden" }),
          Decoration.inline(pieceFrom + marker, pieceFrom + piece.length - marker, { class: marker === 2 ? "notes-strong" : "notes-code-inline" }),
          Decoration.inline(pieceFrom + piece.length - marker, pieceFrom + piece.length, { class: "notes-source-hidden" }),
        );
      });
    });
  });
  return found;
}

/** Every note keeps a unique id (a split or a paste copies one), and lesson timestamps like [12:34] seek the video. */
const NotesBehaviour = Extension.create<{ onSeek: (ms: number) => void }>({
  name: "notesBehaviour",
  addOptions: () => ({ onSeek: () => undefined }),
  addProseMirrorPlugins() {
    const { onSeek } = this.options;
    const focus = (value: boolean) => (view: EditorView) => { view.dispatch(view.state.tr.setMeta(focusKey, value)); return false; };
    return [
      new Plugin({
        key: focusKey,
        state: { init: () => false, apply: (tr, value: boolean) => (tr.getMeta(focusKey) as boolean | undefined) ?? value },
        props: { handleDOMEvents: { focus: focus(true), blur: focus(false) } },
      }),
      new Plugin({
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const seen = new Set<string>();
          let tr: Transaction | null = null;
          state.doc.forEach((node, offset) => {
            const id = node.attrs.id as string | null;
            if (id && !seen.has(id)) { seen.add(id); return; }
            // A new line after a heading or a quote is a plain paragraph; lists and tasks carry on.
            const kind = node.attrs.kind === "bullet" || node.attrs.kind === "task" || node.textContent ? node.attrs.kind : "paragraph";
            const fresh = newId();
            seen.add(fresh);
            tr = (tr ?? state.tr).setNodeMarkup(offset, undefined, { ...node.attrs, id: fresh, kind, done: false, by: "you", fresh: false });
          });
          return tr;
        },
      }),
      new Plugin({
        props: {
          decorations: (state) => {
            const found: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              for (const match of node.text.matchAll(TIME)) {
                const ms = ((Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1_000;
                found.push(Decoration.inline(pos + match.index, pos + match.index + match[0].length, { class: "notes-time", "data-ms": String(ms), title: "Play from here" }));
              }
            });
            return DecorationSet.create(state.doc, [...found, ...inlineDecorations(state)]);
          },
          handleClick: (_view, _pos, event) => {
            const time = (event.target as HTMLElement | null)?.closest<HTMLElement>(".notes-time");
            if (!time) return false;
            onSeek(Number(time.dataset.ms));
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * The notebook as one editor. The learner writes anywhere; a moment after they stop, their changes are saved as edits.
 * Luny's edits arrive as new saved notes and replace the page, unless the learner has unsaved changes, which go first.
 */
export function NotesEditor({ blocks, revision, onOps, onSeek }: { blocks: NoteBlock[]; revision: number; onOps: (ops: NoteOp[]) => void; onSeek: (ms: number) => void }) {
  // What the page showed before the learner's unsaved changes: their edits are the difference from it, never from a newer
  // version with Luny's latest edits, which would undo them.
  const base = useRef<PageBlock[]>(blocks);
  const view = useRef({ blocks, revision });
  view.current = { blocks, revision };
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ onOps, onSeek });
  latest.current = { onOps, onSeek };
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ document: false, paragraph: false, heading: false, blockquote: false, codeBlock: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, horizontalRule: false, hardBreak: false, bold: false, italic: false, strike: false, code: false, underline: false, link: false, trailingNode: false }),
      Doc, NoteBlockNode, NoteMediaNode, NotesBehaviour.configure({ onSeek: (ms) => latest.current.onSeek(ms) }),
    ],
    content: toDoc(blocks, revision),
    editorProps: { attributes: { class: "notes-page", "aria-label": "Notes", spellcheck: "true" } },
    onUpdate: ({ editor: current, transaction }) => {
      if (transaction.getMeta("saved")) return;
      dirty.current = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        dirty.current = false;
        const page = fromDoc(current.state.doc);
        const ops = diffBlocks(base.current, page);
        base.current = page.filter((block) => block.text.trim()).map((block) => ({ ...block, text: block.text.trim() }));
        if (ops.length) latest.current.onOps(ops);
        // With nothing to save no new version comes back, so show the one that may have arrived meanwhile.
        else load(current);
      }, SAVE_AFTER_MS);
    },
  });
  function load(current: NonNullable<typeof editor>) {
    if (dirty.current) return;
    const { blocks: saved, revision: at } = view.current;
    base.current = saved;
    const next = current.schema.nodeFromJSON(toDoc(saved, at));
    if (next.eq(current.state.doc)) return;
    // Keep the caret in the note it was in, at the same offset, across Luny's edits.
    const { $anchor } = current.state.selection;
    const id = $anchor.depth > 0 ? $anchor.node(1).attrs.id as string : null;
    const offset = $anchor.parentOffset;
    const tr = replaceChanged(current.state.tr, next).setMeta("addToHistory", false).setMeta("saved", true);
    let caret: number | null = null;
    tr.doc.forEach((node, position) => { if (node.attrs.id === id) caret = position + 1 + Math.min(offset, node.content.size); });
    if (caret !== null) tr.setSelection(TextSelection.near(tr.doc.resolve(caret)));
    current.view.dispatch(tr);
  }
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Node views render as the page changes, which React cannot do inside an effect, so the load waits a microtask.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new saved version is the trigger; load reads it from the ref.
  useEffect(() => { if (editor) queueMicrotask(() => load(editor)); }, [editor, blocks, revision]);
  return <EditorContent editor={editor} className="notes-editor" />;
}
