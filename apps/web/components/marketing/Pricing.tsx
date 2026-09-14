import { Landscape } from "./Landscape";

const plans = [
	{
		name: "Starter",
		price: 19,
		description: "Great for small teams just getting started.",
		features: [
			"Up to 5 team members",
			"2 project boards",
			"Basic async updates",
			"7-day activity history",
			"Email support",
		],
	},
	{
		name: "Pro",
		price: 59,
		description: "For growing teams that need full visibility.",
		features: [
			"Unlimited team members",
			"Unlimited boards & tasks",
			"Smart status automation",
			"Full activity history",
			"Slack & Calendar integration",
		],
	},
] as const;

export function Pricing() {
	return (
		<section
			className="pricing content-container"
			id="pricing"
			aria-labelledby="pricing-title"
		>
			<header data-reveal="fade">
				<h2 id="pricing-title">Choose the best plan</h2>
				<p>Flexible pricing built for every stage, from startup to scale</p>
			</header>
			<div className="plan-grid">
				{plans.map((plan, index) => (
					<article
						className={`plan${index === 0 ? " plan-featured" : ""}`}
						key={plan.name}
						data-reveal="card"
						data-reveal-delay={index === 0 ? "0" : "100"}
					>
						{index === 0 && <Landscape />}
						<h3>{plan.name}</h3>
						<div className="price">
							<b>${plan.price}</b>
							<span>/month</span>
						</div>
						<p>{plan.description}</p>
						<div className="plan-includes">
							<strong>What&apos;s included</strong>
							<ul>
								{plan.features.map((feature) => (
									<li key={feature}>
										<span className="plan-check" aria-hidden="true">
											✓
										</span>
										{feature}
									</li>
								))}
							</ul>
							<a
								className="plan-button"
								href="/register"
								aria-label={`Get started with ${plan.name}`}
							>
								Get started
							</a>
						</div>
					</article>
				))}
			</div>
		</section>
	);
}
