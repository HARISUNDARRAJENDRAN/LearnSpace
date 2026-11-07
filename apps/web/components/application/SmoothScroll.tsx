"use client";

import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { useEffect } from "react";

/** Smooths wheel scrolling in the app. Frames run only while a scroll is moving, so an idle page does no work. */
export function SmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({
      allowNestedScroll: true,
      stopInertiaOnNavigate: true,
      // A modal dialog scrolls on its own; the page behind it stays put.
      prevent: (node) => node.nodeName === "DIALOG",
    });
    let frame = 0;
    const tick = (time: number) => {
      lenis.raf(time);
      frame = lenis.isScrolling ? requestAnimationFrame(tick) : 0;
    };
    const stop = lenis.on("virtual-scroll", () => {
      if (!frame) frame = requestAnimationFrame(tick);
    });
    return () => {
      stop();
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  return null;
}
