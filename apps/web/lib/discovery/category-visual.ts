export type CategoryVisual = {
  hue: number;
  endHue: number;
  style: number;
  angle: number;
  x: number;
  y: number;
};

export function categoryVisual(slug: string): CategoryVisual {
  let hash = 2166136261;
  for (const character of slug) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const seed = hash >>> 0;
  const hue = seed % 360;
  return {
    hue,
    endHue: (hue + 38 + ((seed >>> 9) % 46)) % 360,
    style: seed % 12,
    angle: 25 + ((seed >>> 7) % 310),
    x: 12 + ((seed >>> 15) % 76),
    y: 10 + ((seed >>> 22) % 80),
  };
}
