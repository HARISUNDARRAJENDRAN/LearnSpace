import { Check, FileText, Play, Sparkles } from "lucide-react";

import { CardRow, FeatureCard } from "./primitives";

const lessons = [
	["Transformers from scratch", "42 min · Deep learning", "sky"],
	["Attention, visualized", "18 min · Deep learning", "lilac"],
	["Matrix calculus refresher", "25 min · Linear algebra", "mint"],
] as const;

const interests = [
	["Deep learning", 82, "+6"],
	["Linear algebra", 64, "+3"],
	["Systems design", 41, ""],
	["Statistics", 28, ""],
] as const;

export function DiscoveryCards() {
	return (
		<CardRow>
			<FeatureCard wash="sky" title="Matched to your interests" text="Every lesson in your feed traces back to a topic you chose, never to what is trending.">
				<div className="ls-bubble">Lessons on transformers, beginner friendly</div>
				<div className="ls-panel ls-panel-bleed">
					<div className="ls-panel-head">
						<Sparkles />3 lessons matched to Deep learning
					</div>
					{lessons.map(([title, meta, tone]) => (
						<div className="ls-row" key={title}>
							<span className={`ls-thumb ls-wash-${tone}`}>
								<Play />
							</span>
							<span className="ls-row-text">
								<b>{title}</b>
								<small>{meta}</small>
							</span>
						</div>
					))}
				</div>
			</FeatureCard>
			<FeatureCard wash="lilac" title="Papers, not just videos" text="The same agent finds the research behind a lesson and adds it to your session.">
				<div className="ls-bubble">Find the paper behind this lecture</div>
				<div className="ls-panel ls-panel-bleed ls-paper">
					<span className="ls-chip">
						<FileText />
						arXiv · cs.CL
					</span>
					<b className="ls-paper-title">Attention Is All You Need</b>
					<small>Vaswani et al. · 2017</small>
					<span className="ls-lines">
						<i style={{ width: "100%" }} />
						<i style={{ width: "92%" }} />
						<i style={{ width: "96%" }} />
						<i style={{ width: "60%" }} />
					</span>
					<span className="ls-chip ls-chip-success">
						<Check />
						Added to session
					</span>
				</div>
			</FeatureCard>
			<FeatureCard wash="mint" title="Learns while you watch" text="What you finish, rewatch and ask about shapes the next lesson you see.">
				<div className="ls-panel ls-panel-float">
					<div className="ls-panel-head">Your interests</div>
					{interests.map(([name, value, change]) => (
						<div className="ls-meter" key={name}>
							<span className="ls-meter-label">
								{name}
								{change ? <em>{change}</em> : null}
							</span>
							<span className="ls-meter-track">
								<i style={{ width: `${value}%` }} />
							</span>
						</div>
					))}
					<small className="ls-panel-foot">Updated after today’s session</small>
				</div>
			</FeatureCard>
		</CardRow>
	);
}
