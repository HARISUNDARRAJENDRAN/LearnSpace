import { type NoteDiagram, diagramSchema } from "@learnspace/shared/notes";
import type { Edge, Node } from "@xyflow/react";

type Shape = NoteDiagram["nodes"][number];
export type NodeData = { label: string; color?: Shape["color"]; shape?: Shape["shape"]; editing?: boolean };
export type EdgeData = { label: string; editing?: boolean };
export type DiagramNode = Node<NodeData, "note">;
export type DiagramEdge = Edge<EdgeData, "note">;
export type Flow = { nodes: DiagramNode[]; edges: DiagramEdge[]; height: number };

/** The drawing is 600 wide and `height` tall; node positions are their centres as fractions of it. */
export const CANVAS_WIDTH = 600;
export const DEFAULT_HEIGHT = 340;
export const NODE_SIZE = { w: 130, h: 48 };
export const HEIGHT_LIMITS = { min: 160, max: 800 };

const round = (value: number) => Math.round(value * 1_000) / 1_000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function parseDiagram(text: string): NoteDiagram | null {
  try { const parsed = diagramSchema.safeParse(JSON.parse(text)); return parsed.success ? parsed.data : null; } catch { return null; }
}

export function toFlow(diagram: NoteDiagram): Flow {
  const height = diagram.height ?? DEFAULT_HEIGHT;
  const ids = new Set(diagram.nodes.map((node) => node.id));
  return {
    height,
    nodes: diagram.nodes.map((node) => {
      const w = node.w ?? NODE_SIZE.w; const h = node.h ?? NODE_SIZE.h;
      return { id: node.id, type: "note", position: { x: node.x * CANVAS_WIDTH - w / 2, y: node.y * height - h / 2 }, width: w, height: h, data: { label: node.label, color: node.color, shape: node.shape } };
    }),
    // An arrow to a box that is gone has nothing to point at.
    edges: diagram.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)).map((edge, index) => ({ id: `${edge.from}>${edge.to}#${index}`, type: "note", source: edge.from, target: edge.to, data: { label: edge.label } })),
  };
}

export function fromFlow({ nodes, edges, height }: Flow): NoteDiagram {
  return {
    nodes: nodes.map((node) => {
      const w = Math.round(node.width ?? NODE_SIZE.w); const h = Math.round(node.height ?? NODE_SIZE.h);
      return {
        id: node.id, label: node.data.label,
        x: round(clamp((node.position.x + w / 2) / CANVAS_WIDTH, 0, 1)), y: round(clamp((node.position.y + h / 2) / height, 0, 1)),
        ...(w === NODE_SIZE.w ? {} : { w }), ...(h === NODE_SIZE.h ? {} : { h }),
        ...(node.data.color ? { color: node.data.color } : {}), ...(node.data.shape ? { shape: node.data.shape } : {}),
      };
    }),
    edges: edges.map((edge) => ({ from: edge.source, to: edge.target, label: edge.data?.label ?? "" })),
    ...(height === DEFAULT_HEIGHT ? {} : { height }),
  };
}

export const serialize = (flow: Flow) => JSON.stringify(fromFlow(flow));
