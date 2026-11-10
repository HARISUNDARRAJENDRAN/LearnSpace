"use client";

import { useEffect, useState } from "react";

// A chevron wavefront driving right across a 3×3 grid; the 650ms cycle is shorter than the sweep, so two fronts are always in flight.
const DELAYS = Array.from({ length: 9 }, (_, index) => (index % 3 + Math.abs(Math.floor(index / 3) - 1)) * 90);

function elapsedLabel(tenths: number): string {
  const seconds = tenths / 10;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

/** A pixel-grid loader with a shimmering label and a live elapsed timer, for work that takes seconds. */
export function LoadingState({ label }: { label: string }) {
  const [tenths, setTenths] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTenths((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="loading-state" role="status">
      {/* biome-ignore lint/suspicious/noArrayIndexKey: the grid's cells are fixed. */}
      <span className="loading-grid" aria-hidden="true">{DELAYS.map((delay, index) => <span key={index} style={{ animationDelay: `${delay}ms` }} />)}</span>
      <span className="loading-label">{label}</span>
      <span className="loading-elapsed" aria-hidden="true">{elapsedLabel(tenths)}</span>
    </div>
  );
}
