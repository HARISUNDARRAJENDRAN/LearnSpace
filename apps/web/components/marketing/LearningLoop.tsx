"use client";

import { CirclePlay, Compass, Dumbbell, Hammer, MessageCircleQuestionMark, Network, NotebookPen, RotateCcw, Telescope } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Sky } from "./Sky";

const steps = [
	[Compass, "Discover", "Lessons and papers matched to your goal."],
	[CirclePlay, "Consume", "Watch and read without a feed in the way."],
	[MessageCircleQuestionMark, "Query", "Ask the lesson. Answers cite the moment."],
	[Dumbbell, "Practice", "Quizzes and code, one hint at a time."],
	[Telescope, "Research", "Follow the citations into the papers."],
	[Hammer, "Implement", "Build the idea in a live editor."],
	[NotebookPen, "Capture", "Notes that stay with the lesson."],
	[Network, "Connect", "New ideas link to what you know."],
	[RotateCcw, "Revisit", "Weak spots return before you forget."],
] as const;

const turn = 360 / steps.length;
const pad = (value: number) => String(value).padStart(2, "0");

/** The nine-step learning loop as an orbit that advances on its own and follows the pointer. */
export function LearningLoop() {
	// `tick` only grows, so the hand always turns clockwise, even across laps.
	const [tick, setTick] = useState(0);
	const [paused, setPaused] = useState(false);
	const [inView, setInView] = useState(false);
	const stage = useRef<HTMLDivElement>(null);
	const active = tick % steps.length;
	const [Icon, name, text] = steps[active] ?? steps[0];

	useEffect(() => {
		if (!stage.current) return;
		const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), { threshold: 0.3 });
		observer.observe(stage.current);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (paused || !inView || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const timer = window.setInterval(() => setTick((value) => value + 1), 2400);
		return () => window.clearInterval(timer);
	}, [paused, inView]);

	const goTo = (index: number) => setTick((value) => value + ((index - (value % steps.length) + steps.length) % steps.length));

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only pause autoplay; the steps are buttons
		<div
			className="ls-loop-stage"
			ref={stage}
			onPointerEnter={() => setPaused(true)}
			onPointerLeave={() => setPaused(false)}
			onFocus={() => setPaused(true)}
			onBlur={() => setPaused(false)}
		>
			<Sky id="ls-loop-sky" />
			<div className="ls-loop-orbit">
				<span className="ls-loop-hand" style={{ transform: `rotate(${tick * turn}deg)` }} aria-hidden="true" />
				<div className="ls-loop-core">
					<div className="ls-loop-core-body" key={active}>
						<span className="ls-loop-core-icon">
							<Icon aria-hidden="true" />
						</span>
						<small>
							Step {pad(active + 1)} of {pad(steps.length)}
						</small>
						<b>{name}</b>
						<p>{text}</p>
					</div>
				</div>
				<ol className="ls-loop-nodes" aria-label="The learning loop">
					{steps.map(([, stepName], index) => (
						<li key={stepName} style={{ transform: `translate(-50%, -50%) rotate(${index * turn}deg) translateY(calc(var(--r) * -1)) rotate(${-index * turn}deg)` }}>
							<button
								type="button"
								className={index < active ? "ls-loop-node is-passed" : "ls-loop-node"}
								aria-current={index === active ? "step" : undefined}
								onClick={() => goTo(index)}
								onPointerEnter={() => goTo(index)}
							>
								<span className="ls-loop-num">{pad(index + 1)}</span>
								<span className="ls-loop-name">{stepName}</span>
							</button>
						</li>
					))}
				</ol>
			</div>
		</div>
	);
}
