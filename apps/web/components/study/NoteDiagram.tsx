"use client";

import { DIAGRAM_COLORS, DIAGRAM_SHAPES } from "@learnspace/shared/notes";
import {
  BaseEdge, type Connection, ConnectionMode, type EdgeProps, EdgeLabelRenderer, getStraightPath, Handle, type InternalNode, MarkerType, NodeResizer,
  type NodeProps, NodeToolbar, Position, ReactFlow, ReactFlowProvider, useEdgesState, useInternalNode, useNodesState, useReactFlow,
} from "@xyflow/react";
import { Circle, Pencil, Plus, RectangleHorizontal, Square, Trash2 } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { CANVAS_WIDTH, type DiagramEdge, type DiagramNode, type Flow, HEIGHT_LIMITS, NODE_SIZE, parseDiagram, serialize, toFlow } from "./diagram";

const MAX_NODES = 30;
const MAX_EDGES = 40;
const ARROW = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--n-edge)" } as const;
const SHAPE_ICONS = { box: Square, pill: RectangleHorizontal, circle: Circle };
const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];
const newId = () => crypto.randomUUID().slice(0, 8);

/** A label typed in place: Enter keeps it, Escape or an empty box keeps the old one. */
function LabelInput({ value, max, required, onDone }: { value: string; max: number; required: boolean; onDone: (label: string) => void }) {
  const cancelled = useRef(false);
  // biome-ignore lint/a11y/noAutofocus: the box opens on the learner's double-click or Rename, so typing goes straight into it.
  return <input className="nodrag nopan notes-diagram-input" autoFocus defaultValue={value} maxLength={max} aria-label="Label"
    onFocus={(event) => event.currentTarget.select()}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") { cancelled.current = true; event.currentTarget.blur(); }
    }}
    onBlur={(event) => { const label = event.currentTarget.value.trim(); onDone(cancelled.current || (required && !label) ? value : label); }} />;
}

function NoteNode({ id, data, selected, positionAbsoluteX, positionAbsoluteY, width = NODE_SIZE.w, height = NODE_SIZE.h }: NodeProps<DiagramNode>) {
  const { updateNodeData, setNodes, deleteElements, getNodes } = useReactFlow<DiagramNode, DiagramEdge>();
  const shape = data.shape ?? "box";
  function reshape(next: (typeof DIAGRAM_SHAPES)[number]) {
    // A circle is round: it becomes a square about its centre.
    const size = Math.max(80, Math.min(width, height));
    setNodes((nodes) => nodes.map((node) => node.id !== id ? node : next === "circle"
      ? { ...node, width: size, height: size, position: { x: node.position.x + (width - size) / 2, y: node.position.y + (height - size) / 2 }, data: { ...node.data, shape: next } }
      : { ...node, data: { ...node.data, shape: next } }));
  }
  // The toolbar sits above the box (below it at the top edge), lined up with the side nearer the middle so it stays in view.
  const middle = positionAbsoluteX + width / 2;
  return <>
    <NodeResizer isVisible={selected && !data.editing} minWidth={48} minHeight={28} maxWidth={480} maxHeight={320} keepAspectRatio={shape === "circle"} lineClassName="notes-diagram-frame" handleClassName="notes-diagram-grip" />
    <NodeToolbar isVisible={selected && !data.editing} position={positionAbsoluteY < 50 ? Position.Bottom : Position.Top} offset={10} align={middle < CANVAS_WIDTH / 3 ? "start" : middle > CANVAS_WIDTH * 2 / 3 ? "end" : "center"} className="notes-diagram-toolbar">
      <fieldset aria-label="Colour">
        {DIAGRAM_COLORS.map((color) => <button key={color} type="button" className={`notes-diagram-swatch is-${color}`} aria-label={color} title={color} aria-pressed={(data.color ?? "mint") === color} onClick={() => updateNodeData(id, { color })} />)}
      </fieldset>
      <fieldset aria-label="Shape">
        {DIAGRAM_SHAPES.map((value) => { const Icon = SHAPE_ICONS[value]; return <button key={value} type="button" aria-label={value} title={value} aria-pressed={shape === value} onClick={() => reshape(value)}><Icon aria-hidden="true" /></button>; })}
      </fieldset>
      <fieldset aria-label="Edit">
        <button type="button" aria-label="Rename" title="Rename" onClick={() => updateNodeData(id, { editing: true })}><Pencil aria-hidden="true" /></button>
        {getNodes().length > 1 ? <button type="button" aria-label="Delete box" title="Delete" onClick={() => void deleteElements({ nodes: [{ id }] })}><Trash2 aria-hidden="true" /></button> : null}
      </fieldset>
    </NodeToolbar>
    {SIDES.map((side) => <Handle key={side} id={side} type="source" position={side} className="notes-diagram-handle" />)}
    <div className={`notes-diagram-node is-${data.color ?? "mint"} is-${shape}`}>
      {data.editing ? <LabelInput value={data.label} max={100} required onDone={(label) => updateNodeData(id, { label, editing: false })} /> : <span>{data.label}</span>}
    </div>
  </>;
}

/** Where the line from a node's centre toward a point leaves its outline. */
function rim(node: InternalNode<DiagramNode>, toward: { x: number; y: number }) {
  const w = (node.measured.width ?? NODE_SIZE.w) / 2; const h = (node.measured.height ?? NODE_SIZE.h) / 2;
  const centre = { x: node.internals.positionAbsolute.x + w, y: node.internals.positionAbsolute.y + h };
  const dx = toward.x - centre.x; const dy = toward.y - centre.y;
  if (!dx && !dy) return centre;
  const scale = node.data.shape === "circle" ? 1 / Math.hypot(dx / w, dy / h) : Math.min(dx ? w / Math.abs(dx) : Infinity, dy ? h / Math.abs(dy) : Infinity);
  return { x: centre.x + dx * scale, y: centre.y + dy * scale };
}
const centreOf = (node: InternalNode<DiagramNode>) => ({ x: node.internals.positionAbsolute.x + (node.measured.width ?? 0) / 2, y: node.internals.positionAbsolute.y + (node.measured.height ?? 0) / 2 });

/** Arrows run centre to centre and stop at the outlines, so they never depend on which handle was dragged. */
function NoteEdge({ id, source, target, data, markerEnd }: EdgeProps<DiagramEdge>) {
  const from = useInternalNode<DiagramNode>(source); const to = useInternalNode<DiagramNode>(target);
  const { updateEdgeData } = useReactFlow<DiagramNode, DiagramEdge>();
  if (!from || !to) return null;
  const start = rim(from, centreOf(to)); const end = rim(to, centreOf(from));
  const [path, x, y] = getStraightPath({ sourceX: start.x, sourceY: start.y, targetX: end.x, targetY: end.y });
  return <>
    <BaseEdge id={id} path={path} {...(markerEnd ? { markerEnd } : {})} interactionWidth={18} />
    {data?.label || data?.editing ? <EdgeLabelRenderer>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a mouse shortcut to relabel an arrow, like double-clicking the arrow itself. */}
      <div className="nodrag nopan notes-diagram-edge-label" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }} onDoubleClick={() => updateEdgeData(id, { editing: true })}>
        {data.editing ? <LabelInput value={data.label} max={60} required={false} onDone={(label) => updateEdgeData(id, { label, editing: false })} /> : data.label}
      </div>
    </EdgeLabelRenderer> : null}
  </>;
}

const nodeTypes = { note: NoteNode };
const edgeTypes = { note: NoteEdge };
const withArrows = (flow: Flow): Flow => ({ ...flow, edges: flow.edges.map((edge) => ({ ...edge, markerEnd: ARROW })) });

function DiagramEditor({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: later versions arrive through the effect below.
  const initial = useMemo(() => withArrows(toFlow(parseDiagram(text) ?? { nodes: [], edges: [] })), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [height, setHeight] = useState(initial.height);
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? height;
  const saved = useRef(serialize(initial));
  const latest = useRef(onChange);
  latest.current = onChange;
  const { setViewport } = useReactFlow();
  const box = useRef<HTMLDivElement>(null);

  // A newer version from the page (the scribe, an undo) replaces the drawing, unless it is the one this editor just saved.
  useEffect(() => {
    const diagram = parseDiagram(text);
    if (!diagram) return;
    const next = withArrows(toFlow(diagram));
    const value = serialize(next);
    if (value === saved.current) return;
    saved.current = value;
    setNodes(next.nodes); setEdges(next.edges); setHeight(next.height);
  }, [text, setNodes, setEdges]);
  // Each finished change is saved; a drag or a resize only once it is let go.
  useEffect(() => {
    if (nodes.some((node) => node.dragging || node.resizing)) return;
    const value = serialize({ nodes, edges, height });
    if (value === saved.current) return;
    saved.current = value;
    latest.current(value);
  }, [nodes, edges, height]);
  // The drawing always fills the box's width, so a pixel of the drawing is the same everywhere in it.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { void setViewport({ x: 0, y: 0, zoom: element.clientWidth / CANVAS_WIDTH }); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [setViewport]);

  // The box can't be made shorter than its lowest node.
  const lowest = () => Math.max(HEIGHT_LIMITS.min, ...nodes.map((node) => Math.ceil(node.position.y + (node.height ?? NODE_SIZE.h))));
  const fit = (value: number) => Math.round(Math.min(HEIGHT_LIMITS.max, Math.max(lowest(), value)));
  function stretch(event: PointerEvent<HTMLDivElement>) {
    const handle = event.currentTarget; const startY = event.clientY; const scale = (box.current?.clientWidth ?? CANVAS_WIDTH) / CANVAS_WIDTH;
    let value = height;
    handle.setPointerCapture(event.pointerId);
    const move = (next: globalThis.PointerEvent) => { value = fit(height + (next.clientY - startY) / scale); setDraft(value); };
    const end = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); handle.removeEventListener("pointercancel", end); setHeight(value); setDraft(null); };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
  }
  function nudge(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0;
    if (!step) return;
    event.preventDefault();
    setHeight(fit(height + step));
  }
  function addNode() {
    const id = newId();
    // New boxes land in the middle, stepped so a few in a row don't stack.
    const step = (nodes.length % 6) * 14;
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), {
      id, type: "note", selected: true, width: NODE_SIZE.w, height: NODE_SIZE.h,
      position: { x: CANVAS_WIDTH / 2 - NODE_SIZE.w / 2 + step, y: Math.min(shown - NODE_SIZE.h, shown / 2 - NODE_SIZE.h / 2 + step) },
      data: { label: "New idea", editing: true },
    }]);
  }
  function connect(connection: Connection) {
    if (connection.source === connection.target) return;
    setEdges((current) => current.length >= MAX_EDGES || current.some((edge) => edge.source === connection.source && edge.target === connection.target) ? current
      : [...current, { id: newId(), type: "note", source: connection.source, target: connection.target, markerEnd: ARROW, data: { label: "" } }]);
  }

  const labels = nodes.map((node) => node.data.label).join(", ");
  return <figure className="notes-diagram" aria-label={`Diagram: ${labels}`} onDragStart={(event) => event.preventDefault()}>
    <div ref={box} className="notes-diagram-canvas" style={{ aspectRatio: `${CANVAS_WIDTH} / ${shown}` }}>
      <ReactFlow<DiagramNode, DiagramEdge>
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect}
        onNodeDoubleClick={(_event, node) => setNodes((current) => current.map((each) => each.id === node.id ? { ...each, data: { ...each.data, editing: true } } : each))}
        onEdgeDoubleClick={(_event, edge) => setEdges((current) => current.map((each) => each.id === edge.id ? { ...each, data: { label: each.data?.label ?? "", editing: true } } : each))}
        onBeforeDelete={async ({ nodes: gone, edges: lost }) => gone.length < nodes.length ? true : { nodes: [], edges: lost }}
        connectionMode={ConnectionMode.Loose} nodeExtent={[[0, 0], [CANVAS_WIDTH, shown]]} deleteKeyCode={["Backspace", "Delete"]}
        minZoom={0.1} maxZoom={4} panOnDrag={false} panOnScroll={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false} preventScrolling={false}
        attributionPosition="bottom-left"
      />
      <button type="button" className="notes-diagram-add" onClick={addNode} disabled={nodes.length >= MAX_NODES} aria-label="Add a box" title="Add a box"><Plus aria-hidden="true" /></button>
    </div>
    {/* biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA pattern for a resizable splitter. */}
    <div className="notes-diagram-stretch" role="separator" aria-orientation="horizontal" aria-label="Diagram height" aria-valuemin={HEIGHT_LIMITS.min} aria-valuemax={HEIGHT_LIMITS.max} aria-valuenow={shown} tabIndex={0} onPointerDown={stretch} onKeyDown={nudge} />
  </figure>;
}

/** A diagram the learner can rearrange: drag, resize, recolour and relabel boxes, and draw arrows between them. */
export function NoteDiagram({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  if (!parseDiagram(text)) return <p className="notes-media-error">This diagram needs correcting.</p>;
  return <ReactFlowProvider><DiagramEditor text={text} onChange={onChange} /></ReactFlowProvider>;
}
