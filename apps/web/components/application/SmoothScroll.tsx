"use client";

import Lenis from "lenis";
import { useEffect } from "react";

let scroller: ((element: HTMLElement) => void) | null = null;

/** Scrolls the page to an element through the smoothing, so an in-flight wheel scroll cannot pull it back. */
export function scrollToElement(element: HTMLElement) {
  if (scroller) scroller(element);
  else element.scrollIntoView({ behavior: "smooth", block: "start" });
}

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
    const run = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const stop = lenis.on("virtual-scroll", run);
    scroller = (element) => {
      lenis.scrollTo(element);
      run();
    };
    return () => {
      scroller = null;
      stop();
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  return null;
}
