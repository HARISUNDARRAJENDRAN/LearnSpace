"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useRef } from "react";

export function ResearchCarousel({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  function scroll(direction: number) {
    ref.current?.scrollBy({ left: direction * Math.max(180, ref.current.clientWidth * 0.7), behavior: "smooth" });
  }
  return <div className={`research-carousel ${className}`}>
    <button type="button" className="research-carousel-arrow" aria-label={`Scroll ${label} left`} onClick={() => scroll(-1)}><ChevronLeft aria-hidden="true" /></button>
    <div className="research-carousel-track" ref={ref}>{children}</div>
    <button type="button" className="research-carousel-arrow" aria-label={`Scroll ${label} right`} onClick={() => scroll(1)}><ChevronRight aria-hidden="true" /></button>
  </div>;
}
