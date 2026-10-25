import { useId } from "react";

const spacing = 3.2;
const amplitude = 1;
const wavelength = 7;

function svgId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

// Angles are in degrees, clockwise from 12 o'clock.
function point(cx: number, cy: number, radius: number, angle: number): [number, number] {
  const radians = angle * Math.PI / 180;
  return [cx + radius * Math.sin(radians), cy - radius * Math.cos(radians)];
}

export function arcPath(cx: number, cy: number, radius: number, from: number, to: number): string {
  const [x1, y1] = point(cx, cy, radius, from);
  const [x2, y2] = point(cx, cy, radius, to);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

// One sine wave as smooth quadratic curves through its zero crossings, which keeps the markup small.
function wave(at: (distance: number, offset: number) => [number, number], from: number, to: number): string {
  const half = wavelength / 2;
  const crossing = Math.floor(from / half);
  const format = ([x, y]: [number, number]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  let distance = crossing * half;
  let path = `M${format(at(distance, 0))}Q${format(at(distance + half / 2, (crossing % 2 === 0 ? 2 : -2) * amplitude))} `;
  distance += half;
  path += format(at(distance, 0));
  while (distance < to) {
    distance += half;
    path += `T${format(at(distance, 0))}`;
  }
  return path;
}

/** A rounded arc band filled with wavy concentric lines, like a fingerprint. */
export function WaveArc({ cx, cy, inner, outer, from, to, paint }: { cx: number; cy: number; inner: number; outer: number; from: number; to: number; paint: string }) {
  const mask = svgId(useId());
  const width = outer - inner;
  // Round caps reach past the ends, so draw the texture a little wider.
  const cap = width / 2 / ((inner + outer) / 2) * 180 / Math.PI;
  const rings: string[] = [];
  // Every ring shares the mid-radius phase so neighbouring lines stay parallel.
  const length = (inner + outer) / 2 * Math.PI / 180;
  for (let radius = inner - 1; radius <= outer + 1; radius += spacing) {
    rings.push(wave((distance, offset) => point(cx, cy, radius + offset, distance / length), (from - cap) * length, (to + cap) * length));
  }
  return <g>
    <mask id={mask}><path d={arcPath(cx, cy, (inner + outer) / 2, from, to)} fill="none" stroke="#fff" strokeWidth={width} strokeLinecap="round" /></mask>
    <path d={arcPath(cx, cy, (inner + outer) / 2, from, to)} fill="none" stroke={paint} strokeWidth={width} strokeLinecap="round" opacity=".3" />
    <path d={rings.join(" ")} fill="none" stroke={paint} strokeWidth="1.3" mask={`url(#${mask})`} />
  </g>;
}

/** A rounded horizontal bar filled with wavy lines. */
export function WaveBar({ width, height, paint, x = 0 }: { width: number; height: number; paint: string; x?: number }) {
  const mask = svgId(useId());
  const lines: string[] = [];
  for (let y = 1; y <= height - 1; y += spacing) {
    lines.push(wave((distance, offset) => [distance, y + offset], x, x + width));
  }
  return <g>
    <mask id={mask}><rect x={x} width={width} height={height} rx={height / 2} fill="#fff" /></mask>
    <rect x={x} width={width} height={height} rx={height / 2} fill={paint} opacity=".3" />
    <path d={lines.join(" ")} fill="none" stroke={paint} strokeWidth="1.3" mask={`url(#${mask})`} />
  </g>;
}
