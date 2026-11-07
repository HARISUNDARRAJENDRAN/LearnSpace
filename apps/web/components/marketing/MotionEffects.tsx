"use client";

import Lenis from "lenis";
import "lenis/dist/lenis.css";
import { useEffect } from "react";

/** Smooths wheel scrolling, scrolls to in-page links, and fades `[data-reveal]` elements in as they scroll into view. */
export function MotionEffects() {
	useEffect(() => {
		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const lenis = reduceMotion ? null : new Lenis({ autoRaf: true });

		const onClick = (event: MouseEvent) => {
			const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
			const target = link?.hash ? document.getElementById(link.hash.slice(1)) : null;
			if (!link || !target) return;
			event.preventDefault();
			history.pushState(null, "", link.hash);
			window.dispatchEvent(new HashChangeEvent("hashchange"));
			// A hidden tab panel has no box, so scroll to the section that holds it.
			const destination = target.closest("section") ?? target;
			if (lenis) lenis.scrollTo(destination);
			else destination.scrollIntoView();
		};
		document.addEventListener("click", onClick);
		if (reduceMotion) return () => document.removeEventListener("click", onClick);

		const root = document.documentElement;
		root.classList.add("motion-ready");
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					entry.target.classList.add("is-visible");
					observer.unobserve(entry.target);
				}
			},
			{ threshold: 0.12, rootMargin: "0px 0px -8%" },
		);
		for (const element of document.querySelectorAll<HTMLElement>("[data-reveal]")) observer.observe(element);

		return () => {
			document.removeEventListener("click", onClick);
			observer.disconnect();
			lenis?.destroy();
			root.classList.remove("motion-ready");
		};
	}, []);

	return null;
}
