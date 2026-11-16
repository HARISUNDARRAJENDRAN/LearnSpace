import type { CSSProperties } from "react";

type SiriOrbProps = {
  size?: number;
  className?: string;
  colors?: { bg?: string; c1?: string; c2?: string; c3?: string };
  animationDuration?: number;
};

const defaultColors = { bg: "transparent", c1: "oklch(75% 0.15 350)", c2: "oklch(80% 0.12 200)", c3: "oklch(78% 0.14 280)" };

/** A slowly turning blur of light. Pure CSS (styles/session.css, `.siri-orb`); the duration sets how lively it looks. */
export function SiriOrb({ size = 192, className = "", colors, animationDuration = 20 }: SiriOrbProps) {
  const { bg, c1, c2, c3 } = { ...defaultColors, ...colors };
  const style = {
    width: size, height: size, "--bg": bg, "--c1": c1, "--c2": c2, "--c3": c3,
    "--animation-duration": `${animationDuration}s`, "--blur-amount": `${Math.max(size * 0.08, 8)}px`, "--contrast-amount": Math.max(size * 0.003, 1.8),
  } as CSSProperties;
  return <div className={`siri-orb ${className}`} style={style} aria-hidden="true" />;
}
