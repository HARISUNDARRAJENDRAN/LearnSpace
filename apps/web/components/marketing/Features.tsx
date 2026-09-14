import { MarketingIcon } from "./MarketingIcon";

const features = [
	[
		"note",
		"Smart Note Capture",
		"Quickly jot down ideas, tasks, and reminders without losing flow. Add tags, folders, or checklists to keep everything in order.",
	],
	[
		"brain",
		"Adaptive Organization",
		"Your notes grow with you. Use smart search, categories, and links to connect ideas and find what you need instantly.",
	],
	[
		"flexible",
		"Simple & Flexible",
		"A tool that fits your style—whether for study, work, or personal journaling. Take notes your way, on the fly, and access them anytime.",
	],
] as const;

function OrganizationIllustration() {
	return (
		<div className="organization-illustration" aria-hidden="true">
			<svg viewBox="0 0 420 420" fill="none" aria-hidden="true">
				<defs>
					<linearGradient id="organization-blue" x1="85" y1="76" x2="338" y2="360" gradientUnits="userSpaceOnUse">
						<stop stopColor="#cdeaff" />
						<stop offset="1" stopColor="#9ed3f8" />
					</linearGradient>
				</defs>
				<path d="m74 267 137-79 137 79-137 79-137-79Z" fill="url(#organization-blue)" />
				<path d="m74 267 137 79v43l-137-78v-44Zm274 0-137 79v43l137-78v-44Z" fill="#7bbcf0" />
				<path d="m74 267 137 79 137-79" stroke="#5ea9e4" strokeWidth="4" />
				<path d="M106 267h210" stroke="#fff" strokeOpacity=".7" strokeWidth="3" />
				<g transform="rotate(-15 130 168)">
					<rect x="99" y="138" width="62" height="62" rx="17" fill="#a9daf9" />
					<rect x="118" y="156" width="24" height="24" rx="6" stroke="#fff" strokeWidth="4" />
					<path d="m125 169 5 5 10-12" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
				</g>
				<g transform="rotate(12 212 131)">
					<rect x="181" y="101" width="62" height="62" rx="17" fill="#88c7f2" />
					<circle cx="212" cy="132" r="14" stroke="#fff" strokeWidth="4" />
					<path d="M212 124v16m-8-8h16" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
				</g>
				<g transform="rotate(24 292 186)">
					<rect x="261" y="155" width="62" height="62" rx="17" fill="#a9daf9" />
					<path d="M279 177h26v19h-26zM284 172h16" stroke="#fff" strokeWidth="4" strokeLinejoin="round" />
				</g>
				<g transform="rotate(-5 211 219)">
					<rect x="181" y="188" width="62" height="62" rx="17" fill="#8fcdf4" />
					<path d="m198 217 12-12 17 17-12 12-17-17Z" stroke="#fff" strokeWidth="4" strokeLinejoin="round" />
					<circle cx="211" cy="211" r="3" fill="#fff" />
				</g>
			</svg>
		</div>
	);
}

export function Features() {
	return (
		<section className="features content-container" id="features" aria-labelledby="features-title">
			<div className="feature-copy">
				<span className="eyebrow">earned by users today</span>
				<h2 id="features-title">
					Smarter Notes. One Simple Space to
					<br />
					Capture, Organize &amp; Remember.
				</h2>
				<p>
					Simplify the way you take notes. Write down your thoughts instantly,
					organize them into clear categories, and find anything in seconds.
					Capture ideas in real time, stay focused with smart organization, and
					keep all your notes in one place that moves with you.
				</p>
			</div>
			<div className="feature-layout">
				<OrganizationIllustration />
				<div className="feature-list">
					{features.map(([icon, title, copy]) => (
						<article key={title}>
							<MarketingIcon name={icon} />
							<div>
								<h3>{title}</h3>
								<p>{copy}</p>
							</div>
						</article>
					))}
				</div>
			</div>
		</section>
	);
}
