import { ArrowRight, ChevronLeft, ChevronRight, Play, RotateCw } from "lucide-react";

import { SiteNav } from "./SiteNav";
import { Sky } from "./Sky";

/** Window chrome holding the space for the product demo video, which is not recorded yet. */
function DemoFrame() {
	return (
		<div className="ls-demo" role="img" aria-label="LearnSpace product demo, coming soon">
			<div className="ls-demo-sidebar">
				<div className="ls-demo-lights">
					<span />
					<span />
					<span />
				</div>
				<div className="ls-demo-skeleton">
					<span style={{ width: "42%" }} />
					<span style={{ width: "78%" }} />
					<span style={{ width: "64%" }} />
					<span style={{ width: "36%" }} />
					<span style={{ width: "70%" }} />
					<span style={{ width: "58%" }} />
				</div>
			</div>
			<div className="ls-demo-main">
				<div className="ls-demo-toolbar">
					<ChevronLeft />
					<ChevronRight />
					<RotateCw />
					<span className="ls-demo-address">learn-space.app</span>
				</div>
				<div className="ls-demo-screen">
					<span className="ls-demo-play">
						<Play />
					</span>
					<span>Product demo coming soon</span>
				</div>
			</div>
		</div>
	);
}

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
					<DemoFrame />
				</div>
				<div className="ls-hero-ring" aria-hidden="true" />
			</section>
		</div>
	);
}
