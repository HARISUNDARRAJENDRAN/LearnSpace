"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** The product intro (made in media/intro). It plays muted on a loop; the toggle turns its sound effects on from the start. */
export function DemoVideo() {
	const video = useRef<HTMLVideoElement>(null);
	const [muted, setMuted] = useState(true);
	const [reduceMotion, setReduceMotion] = useState(false);

	useEffect(() => {
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		setReduceMotion(reduce);
		// Browsers block autoplay with sound and some block it outright; the poster stays up then.
		if (!reduce) video.current?.play().catch(() => {});
	}, []);

	const toggleSound = () => {
		const element = video.current;
		if (element && muted) {
			element.currentTime = 0;
			element.play().catch(() => {});
		}
		setMuted(!muted);
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
				<button type="button" className="ls-demo-sound" aria-label={muted ? "Turn sound on" : "Turn sound off"} aria-pressed={!muted} onClick={toggleSound}>
					{muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
				</button>
			)}
		</div>
	);
}
