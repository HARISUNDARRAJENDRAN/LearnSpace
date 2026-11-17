import { Check } from "lucide-react";

import { Band, Eyebrow } from "./primitives";

const plans = [
	{
		name: "Free",
		price: "$0",
		period: "forever",
		description: "Everything you need to start learning with focus.",
		cta: "Start learning",
		features: ["Focused discovery feed", "Tutor chat on every video", "Learning paths", "Learning calendar", "Quizzes after each lesson"],
	},
	{
		name: "Pro",
		price: "$12",
		period: "per month",
		description: "For learners following a plan every day.",
		cta: "Go Pro",
		features: [
			"Everything in Free",
			"Goal-based study plans",
			"Research paper sessions",
			"Live code editor with a hinting tutor",
			"Unlimited study sessions",
		],
	},
] as const;

export function Pricing() {
	return (
		<Band id="pricing" tone="surface" labelledBy="pricing-title">
			<div className="ls-frame ls-section-head is-centered" data-reveal>
				<Eyebrow href="#pricing">Pricing</Eyebrow>
				<h2 className="ls-h2" id="pricing-title">
					Start free.{" "}
					<br />
					Upgrade when it sticks.
				</h2>
			</div>
			<div className="ls-frame ls-frame-flush">
				<div className="ls-grid-cells ls-prices">
					{plans.map((plan) => (
						<article className="ls-price-card" key={plan.name} data-reveal>
							<h3>{plan.name}</h3>
							<p className="ls-price">
								<b>{plan.price}</b>
								<span>{plan.period}</span>
							</p>
							<p className="ls-price-note">{plan.description}</p>
							<a
								className={plan.name === "Pro" ? "ls-btn" : "ls-btn ls-btn-secondary"}
								href="/register"
								aria-label={`${plan.cta} with the ${plan.name} plan`}
							>
								{plan.cta}
							</a>
							<ul>
								{plan.features.map((feature) => (
									<li key={feature}>
										<Check aria-hidden="true" />
										{feature}
									</li>
								))}
							</ul>
						</article>
					))}
				</div>
			</div>
		</Band>
	);
}
