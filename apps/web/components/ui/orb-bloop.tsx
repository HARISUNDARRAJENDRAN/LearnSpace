"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";

export type OrbState = "off" | "loading" | "listening" | "hearing" | "thinking" | "speaking";
export type OrbBloopProps = { state?: OrbState; size?: number; level?: RefObject<number>; className?: string; style?: CSSProperties };

/** Audio-reactive light, drawn into one small canvas. Reuses the voice meter; never opens another microphone or GPU device. */
export function OrbBloop({ state = "off", size = 144, level, className = "", style }: OrbBloopProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const props = useRef({ state, level });
  props.current = { state, level };
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let energy = 0;
    let phase = 0;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = canvas.height = Math.round(size * dpr);
    context.scale(dpr, dpr);
    function draw() {
      if (!context) return;
      const p = props.current;
      const active = p.state === "hearing" || p.state === "speaking";
      energy += ((p.level?.current ?? 0) - energy) * .25;
      phase += reduced.matches ? 0 : active ? .055 : .018;
      context.clearRect(0, 0, size, size);
      const center = size / 2;
      const radius = size * .325;
      for (let layer = 0; layer < 3; layer++) {
        context.beginPath();
        for (let i = 0; i <= 128; i++) {
          const a = i / 128 * Math.PI * 2;
          const ripple = Math.sin(a * 3 + phase) * .025 + Math.cos(a * 5 - phase * 1.4) * .015;
          const pulse = active ? energy * .16 + Math.sin(a * 8 + phase * 3) * energy * .06 : 0;
          const rad = radius * (1 + ripple + pulse + layer * .008);
          const x = center + Math.cos(a) * rad;
          const y = center + Math.sin(a) * rad;
          if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.closePath();
        const angle = phase * .4;
        const gradient = context.createLinearGradient(center + Math.cos(angle) * radius, center + Math.sin(angle) * radius, center - Math.cos(angle) * radius, center - Math.sin(angle) * radius);
        gradient.addColorStop(0, p.state === "thinking" ? "#a6a1ff" : "#5ffff1");
        gradient.addColorStop(.4, "#f5fffd");
        gradient.addColorStop(.65, "#ffffff");
        gradient.addColorStop(1, "#123a38");
        context.strokeStyle = gradient;
        context.lineWidth = layer === 0 ? 1.8 : 1;
        context.globalAlpha = layer === 0 ? 1 : .22;
        context.shadowColor = active ? "#5ffff1" : "#b6eee6";
        context.shadowBlur = layer === 0 ? (active ? 10 : 4) : 0;
        context.stroke();
      }
      context.globalAlpha = 1;
      if (visible && !document.hidden) timer = setTimeout(draw, reduced.matches ? 500 : active ? 33 : 80);
    }
    function restart() { clearTimeout(timer); if (visible && !document.hidden) draw(); }
    const observer = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; restart(); });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", restart);
    reduced.addEventListener("change", restart);
    draw();
    return () => { clearTimeout(timer); observer.disconnect(); document.removeEventListener("visibilitychange", restart); reduced.removeEventListener("change", restart); };
  }, [size]);
  return <canvas ref={canvasRef} className={`voice-orb ${className}`} aria-hidden="true" tabIndex={-1} style={{ width: size, height: size, ...style }} />;
}
export default OrbBloop;
