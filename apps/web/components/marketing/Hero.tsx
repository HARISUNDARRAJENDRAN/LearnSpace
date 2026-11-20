import { ArrowRight, ChevronRight } from "lucide-react";

import { DemoVideo } from "./DemoVideo";
import { SiteNav } from "./SiteNav";
import { Sky } from "./Sky";

export function Hero({ authenticated = false }: { authenticated?: boolean }) {
	const appHref = authenticated ? "/app" : "/register";
	const appLabel = authenticated ? "Open LearnSpace" : "Start learning";

	return (
		<div className="ls-hero-wrap">
			<section className="ls-hero" id="hero" data-testid="marketing-hero" aria-labelledby="hero-title">
				<Sky id="ls-hero-sky" />
				<SiteNav authenticated={authenticated} />
				<header className="ls-hero-header">
					<a className="ls-badge" href="#introduction">
						AI-native learning workspace
						<ChevronRight aria-hidden="true" />
					</a>
					<h1 id="hero-title">
						Learn anything on the internet,{" "}
						<br />
						without the internet’s distractions.
					</h1>
					<a className="ls-btn ls-btn-pill ls-btn-lg" href={appHref}>
						{appLabel}
						<ArrowRight aria-hidden="true" />
					</a>
				</header>
				<div className="ls-hero-stage">
					<DemoVideo />
				</div>
				<div className="ls-hero-ring" aria-hidden="true" />
			</section>
		</div>
	);
}
