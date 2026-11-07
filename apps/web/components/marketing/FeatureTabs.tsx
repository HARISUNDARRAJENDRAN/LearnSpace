"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

export type Feature = { id: string; label: string; icon: ReactNode; title: string; text: string; panel: ReactNode };

/**
 * Feature tabs that advance on their own until the visitor picks one. The active tab's progress bar
 * drives each step through `animationend`, so CSS pauses it on hover, focus, off screen and reduced motion.
 */
export function FeatureTabs({ features }: { features: Feature[] }) {
	const [active, setActive] = useState(0);
	const [autoplay, setAutoplay] = useState(true);
	const [inView, setInView] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const tablist = useRef<HTMLDivElement>(null);

	const select = (index: number) => {
		setActive(index);
		setAutoplay(false);
	};

	useEffect(() => {
		if (!root.current) return;
		const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), { threshold: 0.25 });
		observer.observe(root.current);
		return () => observer.disconnect();
	}, []);

	// Links such as #tutor open their tab. MotionEffects scrolls on click; a page opened at the hash
	// scrolls here, because the browser cannot scroll to a panel that was hidden on load.
	useEffect(() => {
		const openHash = () => {
			const index = features.findIndex((feature) => `#${feature.id}` === window.location.hash);
			if (index < 0) return false;
			setActive(index);
			setAutoplay(false);
			return true;
		};
		if (openHash()) document.getElementById("features")?.scrollIntoView();
		window.addEventListener("hashchange", openHash);
		return () => window.removeEventListener("hashchange", openHash);
	}, [features]);

	// Keep the active tab visible when the tab bar scrolls sideways on small screens.
	useEffect(() => {
		const bar = tablist.current;
		const tab = bar?.children[active] as HTMLElement | undefined;
		if (!bar || !tab || bar.scrollWidth <= bar.clientWidth) return;
		bar.scrollTo({ left: tab.offsetLeft - (bar.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
	}, [active]);

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
		if (!step) return;
		const next = (active + step + features.length) % features.length;
		select(next);
		(event.currentTarget.children[next] as HTMLElement | undefined)?.focus();
	};

	return (
		<div ref={root} className={`ls-feature-tabs${inView ? "" : " is-paused"}`}>
			<div className="ls-frame ls-frame-tabs">
				<div className="ls-tabs" role="tablist" aria-label="Features" ref={tablist} onKeyDown={onKeyDown}>
					{features.map((feature, index) => (
						<button
							key={feature.id}
							id={`${feature.id}-tab`}
							type="button"
							role="tab"
							aria-selected={index === active}
							aria-controls={feature.id}
							tabIndex={index === active ? 0 : -1}
							className={index === active ? "is-active" : undefined}
							onClick={() => select(index)}
						>
							{feature.icon}
							<span className="ls-tab-label">{feature.label}</span>
							{autoplay && index === active ? (
								<span
									className="ls-tab-progress"
									aria-hidden="true"
									onAnimationEnd={() => setActive((value) => (value + 1) % features.length)}
								/>
							) : null}
						</button>
					))}
				</div>
			</div>
			<div className="ls-tabpanels" data-reveal>
				{features.map((feature, index) => (
					<div
						key={feature.id}
						id={feature.id}
						className="ls-tabpanel"
						role="tabpanel"
						aria-labelledby={`${feature.id}-tab`}
						hidden={index !== active}
					>
						<div className="ls-frame ls-tab-intro">
							<h3 className="ls-h3">{feature.title}</h3>
							<p className="ls-body">{feature.text}</p>
						</div>
						{feature.panel}
					</div>
				))}
			</div>
		</div>
	);
}
