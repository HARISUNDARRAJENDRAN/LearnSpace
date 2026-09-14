import Image from "next/image";

export function BannerCta({ authenticated = false }: { authenticated?: boolean }) {
	return (
		<section
			className="landing-cta wide-container banner-cta scenic-panel"
			aria-labelledby="cta-title"
		>
			<Image src="/assets/marketing/learning-path.webp" alt="" fill sizes="(max-width: 1248px) 1200px, (max-width: 1648px) calc(100vw - 48px), 1600px" className="cta-landscape" />
			<div className="cta-content" data-reveal="fade">
				<h2 id="cta-title">Follow your curiosity.<br />Keep the context.</h2>
				<p>
					Start with a video or paper. Follow a question, put it into practice,
					and carry what you learn into whatever comes next.
				</p>
				<div className="hero-actions">
					<a className="button cta-start" href={authenticated ? "/app" : "/register"}>
						{authenticated ? "Continue learning" : "Start learning"} <span aria-hidden="true">→</span>
					</a>
				</div>
			</div>
		</section>
	);
}
