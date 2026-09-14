import { LearnSpaceLogo } from "./hero/LearnSpaceLogo";
import { Landscape } from "./Landscape";

const groups = [
	{
		title: "Product",
		links: [
			["Features", "#features"],
			["How It Works", "#how-it-works"],
			["Pricing", "#pricing"],
		],
	},
	{
		title: "Company",
		links: [
			["About", "#features"],
			["Careers", "#features"],
			["Contact", "#hero"],
			["Press", "#hero"],
		],
	},
	{
		title: "Resources",
		links: [
			["Help Center", "#how-it-works"],
			["Updates", "#features"],
			["Guides", "#how-it-works"],
		],
	},
] as const;

export function Footer() {
	return (
		<footer className="marketing-footer wide-container scenic-panel">
			<Landscape />
			<div className="footer-columns" data-reveal="fade">
				<div className="footer-brand">
					<a href="#hero" aria-label="LearnSpace home">
						<LearnSpaceLogo />
					</a>
					<p>
						Your simple space to capture ideas, stay organized, and never lose a
						thought.
					</p>
				</div>
				{groups.map((group) => (
					<nav key={group.title} aria-label={group.title}>
						<h3>{group.title}</h3>
						{group.links.map(([label, href]) => (
							<a key={label} href={href}>
								{label}
							</a>
						))}
					</nav>
				))}
			</div>
			<div className="footer-bottom" data-reveal="fade" data-reveal-delay="100">
				<span>
					© {new Date().getFullYear()} LearnSpace. All rights reserved.
				</span>
				<div className="footer-socials">
					<a href="https://www.linkedin.com" aria-label="LearnSpace on LinkedIn">
						in
					</a>
					<a href="https://x.com" aria-label="LearnSpace on X">
						𝕏
					</a>
				</div>
			</div>
		</footer>
	);
}
