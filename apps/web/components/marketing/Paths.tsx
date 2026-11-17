import { ArrowRight, Check, Clock, FileText, Lightbulb, Sparkles } from "lucide-react";

import { AppShot, CardRow, FeatureCard } from "./primitives";

// Markup mirrors the app's Research Discover page (learning paths), so it renders with research.css.

const tracks = [
	{
		title: "Transformers & LLMs",
		audience: "Learners who want to understand language-model architecture, pretraining, post-training, and serving.",
		hours: 29,
		papers: 39,
		stages: 5,
	},
	{
		title: "Reinforcement learning to RLHF/GRPO",
		audience: "Learners moving from value-based and policy-gradient RL toward preference optimization for language models.",
		hours: 30,
		papers: 40,
		stages: 4,
	},
];

function TrackMeta({ hours, papers, concepts }: { hours: number; papers: number; concepts?: number }) {
	return (
		<p className="discover-track-meta">
			<span>
				<Clock />~{hours} h
			</span>
			<span>
				<FileText />
				{papers} papers
			</span>
			{concepts ? (
				<span>
					<Lightbulb />
					{concepts} concepts
				</span>
			) : null}
		</p>
	);
}

export function PathCards() {
	return (
		<CardRow>
			<FeatureCard wash="sun" title="Picked for your level" text="A path chosen from what you said you know and want, with the time it really takes.">
				<AppShot scope="research-page discover-page" className="ls-shot-path is-bleed">
					<section className="discover-featured">
						<div>
							<p className="discover-eyebrow">
								<Sparkles />
								Picked for you
							</p>
							<h2>ML research foundations (beginner)</h2>
							<p className="discover-track-audience">
								Learners beginning ML who want a grounded route from mathematical tools to modern learned representations.
							</p>
							<TrackMeta hours={23} papers={28} concepts={4} />
						</div>
					</section>
				</AppShot>
			</FeatureCard>
			<FeatureCard wash="mint" title="Know where it leads" text="Every path says what you will be able to do, then walks you to the next concept in order.">
				<AppShot scope="research-page discover-page" className="ls-shot-outcomes is-bleed">
					<section className="discover-featured">
						<div className="discover-featured-side">
							<p className="discover-label">You will be able to</p>
							<ul className="discover-outcomes">
								{[
									"Explain core supervised-learning and neural-network ideas",
									"Read foundational ML papers and identify their claims",
									"Choose a next specialization based on learned concepts",
								].map((outcome) => (
									<li key={outcome}>
										<Check />
										{outcome}
									</li>
								))}
							</ul>
							<span className="discover-cta">
								Next: Linear algebra
								<ArrowRight />
							</span>
						</div>
					</section>
				</AppShot>
			</FeatureCard>
			<FeatureCard wash="sky" title="A path for every field" text="From transformers to reinforcement learning, each path climbs from the basics to the papers that defined it.">
				<AppShot scope="research-page discover-page" className="ls-shot-tracks is-bleed">
					<ul className="discover-track-grid">
						{tracks.map((track) => (
							<li key={track.title}>
								<span className="discover-track-card">
									<span className="discover-track-stages">
										{Array.from({ length: track.stages }, (_, index) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: stages are positional
											<span key={index} />
										))}
									</span>
									<strong>{track.title}</strong>
									<span className="discover-track-audience">{track.audience}</span>
									<TrackMeta hours={track.hours} papers={track.papers} />
								</span>
							</li>
						))}
					</ul>
				</AppShot>
			</FeatureCard>
		</CardRow>
	);
}
