"use client";

import { useEffect } from "react";

export function MotionEffects() {
	useEffect(() => {
		const root = document.documentElement;
		root.classList.add("motion-ready");

		const elements = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
		for (const element of elements) {
			const delay = Number(element.dataset.revealDelay);
			if (Number.isFinite(delay) && delay > 0) element.style.setProperty("--reveal-delay", `${delay}ms`);
		}
		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const reveal = (element: HTMLElement) => element.classList.add("is-visible");

		if (reducedMotion || !("IntersectionObserver" in window)) {
			elements.forEach(reveal);
			return () => root.classList.remove("motion-ready");
		}

		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						reveal(entry.target as HTMLElement);
						observer.unobserve(entry.target);
					}
				}
			},
			{ threshold: 0.12, rootMargin: "0px 0px -8%" },
		);

		for (const element of elements) observer.observe(element);

		const landscape = document.querySelector<HTMLElement>(".marketing-hero .scenic-mountains");
		let frame = 0;
		const updateParallax = () => {
			frame = 0;
			if (landscape) {
				landscape.style.setProperty("--hero-parallax", `${Math.min(window.scrollY * 0.06, 24)}px`);
			}
		};
		const onScroll = () => {
			if (!frame) frame = window.requestAnimationFrame(updateParallax);
		};

		window.addEventListener("scroll", onScroll, { passive: true });
		updateParallax();

		return () => {
			observer.disconnect();
			window.removeEventListener("scroll", onScroll);
			if (frame) window.cancelAnimationFrame(frame);
			root.classList.remove("motion-ready");
		};
	}, []);

	return null;
}
