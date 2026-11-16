// Fine wavy stripes, the shared look of the mastery score dial and the Home cards: a half ring (or a straight bar) cut
// into rounded blocks and filled with thin wavy strokes whose colour runs along a palette.

export type Stops = [number, [number, number, number]][];

/** Red through orange and yellow to lime: for a score, where low is bad. */
export const HEAT: Stops = [[0, [238, 77, 85]], [0.3, [243, 122, 74]], [0.6, [246, 191, 69]], [0.8, [207, 232, 63]], [1, [169, 234, 58]]];
/** Deep green to lime: for progress, where every step is good. */
export const GROWTH: Stops = [[0, [92, 170, 74]], [0.5, [140, 208, 64]], [1, [197, 240, 106]]];

export function stripeColor(t: number, stops: Stops = HEAT) {
  const upper = stops.findIndex(([at]) => at >= t);
  if (upper <= 0) return `rgb(${stops[0]?.[1].join(",")})`;
  const [a, from] = stops[upper - 1] as Stops[number];
  const [b, to] = stops[upper] as Stops[number];
  const k = (t - a) / (b - a);
  return `rgb(${from.map((value, i) => Math.round(value + ((to[i] ?? value) - value) * k)).join(",")})`;
}

/** The dial's geometry, in a 340×196 viewBox (wider with labels). */
export const DIAL = { cx: 170, cy: 168, inner: 98, outer: 142, stripes: 118 };

/** A point on the dial at `radius`, `theta` radians from the right end. */
export function dialPoint(radius: number, theta: number) {
  return `${(DIAL.cx + radius * Math.cos(theta)).toFixed(2)} ${(DIAL.cy - radius * Math.sin(theta)).toFixed(2)}`;
}

/** A slice of the half ring from `from` to `to` (0 is the left end, 1 the right) with softly rounded corners. */
export function ringSlice(from: number, to: number) {
  const { inner, outer } = DIAL;
  const at = dialPoint;
  const start = Math.PI * (1 - from);
  const end = Math.PI * (1 - to);
  const corner = Math.min(14, ((start - end) * inner) / 2.4);
  return [
    `M ${at(outer - corner, start)}`,
    `A ${corner} ${corner} 0 0 1 ${at(outer, start - corner / outer)}`,
    `A ${outer} ${outer} 0 0 1 ${at(outer, end + corner / outer)}`,
    `A ${corner} ${corner} 0 0 1 ${at(outer - corner, end)}`,
    `L ${at(inner + corner, end)}`,
    `A ${corner} ${corner} 0 0 1 ${at(inner, end + corner / inner)}`,
    `A ${inner} ${inner} 0 0 0 ${at(inner, start - corner / inner)}`,
    `A ${corner} ${corner} 0 0 1 ${at(inner + corner, start)}`,
    "Z",
  ].join(" ");
}

/** The dial's radial stripes, each with its place `t` along the ring and its colour. */
export function dialStripes(stops: Stops) {
  return Array.from({ length: DIAL.stripes + 1 }, (_, index) => {
    const t = index / DIAL.stripes;
    const theta = Math.PI * (1 - t);
    const points: string[] = [];
    for (let radius = DIAL.inner - 4; radius <= DIAL.outer + 4; radius += 4) {
      points.push(dialPoint(radius, theta + (2.6 * Math.sin(radius * 0.19 + index * 0.55)) / radius));
    }
    return { t, d: `M ${points.join(" L ")}`, color: stripeColor(t, stops) };
  });
}

/** A straight bar's geometry, in a BAR.width×BAR.height viewBox. */
export const BAR = { width: 320, height: 26, stripes: 92 };

/** The bar's vertical wavy stripes. */
export function barStripes(stops: Stops) {
  return Array.from({ length: BAR.stripes + 1 }, (_, index) => {
    const t = index / BAR.stripes;
    const x = t * BAR.width;
    const points: string[] = [];
    for (let y = -3; y <= BAR.height + 3; y += 3) points.push(`${(x + 1.3 * Math.sin(y * 0.42 + index * 0.55)).toFixed(2)} ${y}`);
    return { t, d: `M ${points.join(" L ")}`, color: stripeColor(t, stops) };
  });
}

/** A rounded block of the bar from `from` to `to` (fractions of its width). */
export function barSlice(from: number, to: number, radius = 7) {
  const x = from * BAR.width;
  const width = Math.max(0, (to - from) * BAR.width);
  const r = Math.min(radius, width / 2);
  const h = BAR.height;
  return `M ${x + r} 0 H ${x + width - r} A ${r} ${r} 0 0 1 ${x + width} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${x + width - r} ${h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${h - r} V ${r} A ${r} ${r} 0 0 1 ${x + r} 0 Z`;
}
