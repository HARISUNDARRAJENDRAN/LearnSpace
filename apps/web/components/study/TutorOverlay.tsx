"use client";

import type { TutorMark } from "@learnspace/shared/notes";
import { useId, useRef } from "react";

const colors = { cyan: "#5ffff1", pink: "#ff7fbd", yellow: "#ffe77b", white: "#fff" };
export type LessonPoint = { x: number; y: number };

/** Lives inside the video card: normalized marks follow the lesson through pan, zoom, focus and fullscreen. */
export function TutorOverlay({ marks, drawing, onMark, onPoint }: { marks: TutorMark[]; drawing: boolean; onMark: (mark: TutorMark) => void; onPoint: (point: LessonPoint) => void }) {
  const marker = useId().replaceAll(":", "");
  const path = useRef<LessonPoint[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const draftRef = useRef<SVGPolylineElement>(null);
  const point = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) };
  };
  return <svg ref={svgRef} className={`tutor-overlay${drawing ? " is-drawing" : ""}`} viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label={drawing ? "Draw on the lesson" : "Luna’s lesson annotations"}
    onPointerDown={(event) => { if (!drawing) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); const p = point(event); path.current = [p]; onPoint(p); }}
    onPointerMove={(event) => { if (!drawing || !event.currentTarget.hasPointerCapture(event.pointerId) || path.current.length >= 100) return; event.stopPropagation(); path.current.push(point(event)); draftRef.current?.setAttribute("points", path.current.map((p) => `${p.x * 1000},${p.y * 1000}`).join(" ")); }}
    onPointerUp={(event) => { if (!drawing || !event.currentTarget.hasPointerCapture(event.pointerId)) return; event.stopPropagation(); event.currentTarget.releasePointerCapture(event.pointerId); if (path.current.length === 1) path.current.push(point(event)); onMark({ id: crypto.randomUUID().slice(0, 12), kind: "stroke", points: path.current, color: "yellow", text: "Learner’s drawing" }); path.current = []; draftRef.current?.setAttribute("points", ""); }}
    onPointerCancel={() => { path.current = []; draftRef.current?.setAttribute("points", ""); }}>
    <defs>{Object.entries(colors).map(([name, color]) => <marker key={name} id={`${marker}-${name}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={color} /></marker>)}</defs>
    {marks.map((mark) => {
      const a = mark.points[0]; const b = mark.points.at(-1); if (!a || !b) return null;
      const x = a.x * 1000, y = a.y * 1000, dx = (b.x - a.x) * 1000, dy = (b.y - a.y) * 1000;
      return <g key={mark.id} stroke={colors[mark.color]} fill="none" strokeWidth={3} vectorEffect="non-scaling-stroke">
        {mark.kind === "circle" ? <ellipse cx={x + dx / 2} cy={y + dy / 2} rx={Math.max(8, Math.abs(dx / 2))} ry={Math.max(8, Math.abs(dy / 2))} />
          : mark.kind === "box" ? <rect x={Math.min(x, x + dx)} y={Math.min(y, y + dy)} width={Math.max(8, Math.abs(dx))} height={Math.max(8, Math.abs(dy))} rx={8} />
          : mark.kind === "arrow" ? <path d={`M ${x} ${y} L ${x + dx} ${y + dy}`} markerEnd={`url(#${marker}-${mark.color})`} />
          : mark.kind === "stroke" ? <polyline points={mark.points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(" ")} strokeLinecap="round" strokeLinejoin="round" /> : null}
        {mark.text && mark.kind !== "stroke" ? <text x={Math.max(8, Math.min(800, x))} y={Math.max(30, y - 12)} fill={colors[mark.color]} stroke="#111" paintOrder="stroke" strokeWidth={4} fontSize={25}>{mark.text}</text> : null}
      </g>;
    })}
    <polyline ref={draftRef} fill="none" stroke={colors.yellow} strokeWidth={3} vectorEffect="non-scaling-stroke" />
  </svg>;
}
