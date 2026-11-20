"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function DemoVideo() {
	const video = useRef<HTMLVideoElement>(null);
	const [muted, setMuted] = useState(false);
	const [reduceMotion, setReduceMotion] = useState(false);

	useEffect(() => {
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		setReduceMotion(reduce);
		const element = video.current;
		if (reduce || !element) return;

		void element.play().catch((error: DOMException) => {
			if (error.name !== "NotAllowedError" || !element.paused || element.muted) return;
			element.muted = true;
			setMuted(true);
			void element.play().catch(() => {});
		});
	}, []);

	const toggleSound = () => {
		const element = video.current;
		if (!element) return;

		element.muted = !element.muted;
		setMuted(element.muted);
		if (!element.muted) {
			element.currentTime = 0;
			void element.play().catch(() => {});
		}
	};

	return (
		<div className="ls-demo-video">
			<video
				ref={video}
				muted={muted}
				loop
				playsInline
				preload="metadata"
				poster="/media/learnspace-intro-poster.webp"
				controls={reduceMotion}
				aria-label="LearnSpace product demo"
			>
				<source src="/media/learnspace-intro.mp4" type="video/mp4" />
			</video>
			{reduceMotion ? null : (
				<button type="button" className="ls-demo-sound" aria-label="Demo sound" aria-pressed={!muted} onClick={toggleSound}>
					{muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
				</button>
			)}
		</div>
	);
}
