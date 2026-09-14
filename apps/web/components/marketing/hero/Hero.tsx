import { Landscape } from "../Landscape";
import { HeroNavigation } from "./HeroNavigation";

export function Hero({ authenticated = false }: { authenticated?: boolean }) {
	const appHref = authenticated ? "/app" : "/register";
	const appLabel = authenticated ? "Open LearnSpace" : "Start learning";

	return (
		<section
			className="hero wide-container scenic-panel marketing-hero"
			data-testid="marketing-hero"
			id="hero"
			aria-labelledby="hero-title"
		>
			<Landscape priority />
			<HeroNavigation authenticated={authenticated} />
			<div className="hero-copy" data-reveal="fade">
				<p className="hero-eyebrow" data-reveal="fade" data-reveal-delay="80">AI-NATIVE LEARNING WORKSPACE</p>
				<h1 id="hero-title" data-reveal="fade" data-reveal-delay="140">
					Learn anything.
					<br />
					Lose nothing.
				</h1>
				<p className="hero-description" data-reveal="fade" data-reveal-delay="200">
					Discover videos and papers, ask questions, practice, research, and build —
					all in one learning space that keeps the context with you.
				</p>
				<div className="hero-actions" data-reveal="scale" data-reveal-delay="280">
					<a className="button hero-primary" href={appHref}>
						{appLabel}
					</a>
					<a className="button hero-secondary" href="#how-it-works">
						See how it works <span aria-hidden="true">→</span>
					</a>
				</div>
			</div>
		</section>
	);
}
