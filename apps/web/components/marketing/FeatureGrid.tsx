import { FeatureIllustration, type FeatureConcept } from "./FeatureIllustration";

type Feature = {
	index: string;
	title: string;
	description: string;
	conceptKey: FeatureConcept;
};

const features: Feature[] = [
	{
		index: "01",
		title: "Never lose the thread",
		description:
			"Switch between videos, papers, notes, questions, and practice without starting over. LearnSpace carries your learning context with you.",
		conceptKey: "context",
	},
	{
		index: "02",
		title: "Research papers, made explorable",
		description:
			"Drop in an arXiv paper, DOI, or PDF. Ask about equations, figures, sections, and citations — then follow related research without leaving your session.",
		conceptKey: "research",
	},
	{
		index: "03",
		title: "A tutor that can see what you see",
		description:
			"Talk naturally while you work. Your tutor can understand your visible screen, answer by voice, and point, highlight, or draw directly over what you're looking at.",
		conceptKey: "tutor",
	},
	{
		index: "04",
		title: "Practice before you move on",
		description:
			"When a lesson reaches something you should actually know how to do, LearnSpace can pause, give you a focused exercise, and guide you with hints before you continue.",
		conceptKey: "practice",
	},
	{
		index: "05",
		title: "A Second Brain that knows what you know",
		description:
			"Your Second Brain doesn't just store notes. It learns from what you watch, ask, practice, research, and struggle with — then shows what you've mastered and what needs another look.",
		conceptKey: "mastery",
	},
	{
		index: "06",
		title: "Discovery that cares if you actually learn",
		description:
			"Find videos and papers based on what you're learning, what you already know, and what will help you next — not simply what's popular.",
		conceptKey: "discovery",
	},
];

export function FeatureCard({ index, title, description, conceptKey }: Feature) {
	return (
		<article
			className={`feature-card feature-card-${conceptKey}`}
			data-reveal="card"
			data-reveal-delay={String(Number(index) * 70)}
		>
			<h3>{title}</h3>
			<div className="feature-visual" aria-hidden="true">
				<FeatureIllustration concept={conceptKey} />
			</div>
			<p>{description}</p>
		</article>
	);
}

export function FeatureGrid() {
	return (
		<section className="feature-grid-section content-container" id="features" aria-labelledby="features-title">
			<div className="feature-grid-heading" data-reveal="fade">
				<span className="feature-grid-eyebrow">FEATURES</span>
				<h2 id="features-title">Built for more than just watching.</h2>
				<p>
					LearnSpace connects discovery, study, research, practice, and tutoring into one learning system that understands what you're working on and where you're going next.
				</p>
			</div>
			<div className="feature-grid">
				{features.map((feature) => (
					<FeatureCard key={feature.index} {...feature} />
				))}
			</div>
		</section>
	);
}
