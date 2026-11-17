import { ArrowRight } from "lucide-react";

import { Logo } from "./SiteNav";

const columns = [
	["Features", [["Focused discovery", "#discovery"], ["Real-time tutor", "#tutor"], ["Learning paths", "#paths"], ["Study plan", "#plan"], ["Practice", "#practice"]]],
	["Use cases", [["Developers", "#use-cases"], ["Students", "#use-cases"], ["Researchers", "#use-cases"], ["Interview prep", "#use-cases"]]],
	["Product", [["Pricing", "#pricing"], ["Log in", "/login"], ["Create account", "/register"]]],
] as const;

export function CtaBanner({ authenticated }: { authenticated: boolean }) {
	return (
		<section className="ls-cta" aria-labelledby="cta-title">
			<div className="ls-container">
				<div className="ls-cta-panel">
					<h2 className="ls-h2" id="cta-title" data-reveal>
						Built for learners who finish.{" "}
						<br />
						Start learning today.
					</h2>
					<a className="ls-btn ls-btn-pill ls-btn-lg" href={authenticated ? "/app" : "/register"}>
						{authenticated ? "Open LearnSpace" : "Start learning"}
						<ArrowRight aria-hidden="true" />
					</a>
				</div>
			</div>
		</section>
	);
}

export function Footer() {
	return (
		<footer className="ls-footer">
			<div className="ls-container">
				<div className="ls-footer-grid">
					<div className="ls-footer-brand">
						<Logo />
						<p>Your space to learn, research and remember.</p>
					</div>
					{columns.map(([title, links]) => (
						<nav key={title} aria-label={title}>
							<p>{title}</p>
							<ul>
								{links.map(([label, href]) => (
									<li key={label}>
										<a href={href}>{label}</a>
									</li>
								))}
							</ul>
						</nav>
					))}
				</div>
				<hr />
				<p className="ls-footer-legal">© 2026 LearnSpace</p>
			</div>
		</footer>
	);
}
