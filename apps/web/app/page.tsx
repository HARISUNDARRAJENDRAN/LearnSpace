import type { ReactNode } from "react";

import { Hero } from "../components/marketing/hero/Hero";
import { BannerCta } from "../components/marketing/BannerCta";
import { FeatureGrid } from "../components/marketing/FeatureGrid";
import { Footer } from "../components/marketing/Footer";
import { NotesDemo } from "../components/marketing/NotesDemo";
import { MotionEffects } from "../components/marketing/MotionEffects";
import { Pricing } from "../components/marketing/Pricing";
import { getCurrentSession } from "../lib/auth/session";

export const dynamic = "force-dynamic";

const learningCommunities = [
	["r/learnprogramming", "reddit"],
	["r/MachineLearning", "reddit"],
	["CS50", "circle"],
	["freeCodeCamp", "flame"],
	["Kaggle", "kaggle"],
	["fast.ai", "fastai"],
] as const;

type CommunityIcon = (typeof learningCommunities)[number][1];

function CommunityMark({ type }: { type: CommunityIcon }) {
	const mark = {
		reddit: (
			<>
				<path
					d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z"
				/>
			</>
		),
		circle: <circle cx="9" cy="9" r="6" />,
		flame: <path d="M9 2c2 2 4 3 4 6a4 4 0 1 1-8 0c0-1.5.8-2.8 2-4 0 2 1 2.6 1.8 3.3C9.3 5.6 9.1 3.8 9 2Z" />,
		kaggle: <path d="M100.402 127.243c-.126.501-.627.752-1.502.752H82.168c-1.007 0-1.876-.438-2.632-1.317L51.91 91.531l-7.706 7.33v27.258c0 1.255-.628 1.881-1.88 1.881h-12.97c-1.254 0-1.88-.626-1.88-1.88V1.876c0-1.25.625-1.877 1.88-1.877h12.97c1.253 0 1.882.628 1.882 1.876v76.501l33.08-33.457c.878-.875 1.755-1.315 2.631-1.315h17.295c.75 0 1.25.315 1.504.937.252.753.19 1.316-.19 1.693L63.561 80.062l36.465 45.3c.499.502.625 1.128.38 1.881Z" />,
		fastai: (
			<>
				<rect x="262" y="9" width="191" height="115" rx="2" />
				<rect x="266" y="174" width="134" height="79" rx="2" />
				<rect x="131" y="9" width="57" height="51" rx="2" />
				<rect x="195" y="9" width="56" height="51" rx="2" />
				<rect x="67" y="72" width="56" height="52" rx="2" />
				<rect x="195" y="72" width="56" height="52" rx="2" />
				<rect x="131" y="135" width="57" height="51" rx="2" />
				<rect x="67" y="198" width="56" height="51" rx="2" />
				<rect x="131" y="198" width="57" height="51" rx="2" />
				<rect x="195" y="257" width="56" height="51" rx="2" />
				<rect x="67" y="320" width="56" height="51" rx="2" />
				<rect x="131" y="320" width="57" height="51" rx="2" />
				<rect x="195" y="320" width="56" height="51" rx="2" />
				<rect x="195" y="383" width="56" height="51" rx="2" />
				<rect x="131" y="446" width="57" height="51" rx="2" />
				<rect x="195" y="446" width="56" height="51" rx="2" />
			</>
		),
	} satisfies Record<CommunityIcon, ReactNode>;
	const viewBox = type === "reddit" ? "0 0 24 24" : type === "kaggle" ? "0 0 128 128" : type === "fastai" ? "0 0 512 512" : "0 0 18 18";

	return (
		<span className={`community-mark community-mark-${type}`} aria-hidden="true">
			<svg viewBox={viewBox} fill="none" aria-hidden="true">
				{mark[type]}
			</svg>
		</span>
	);
}

function CommunityGroup({ hidden = false }: { hidden?: boolean }) {
	return (
		<div className="community-marquee-group" aria-hidden={hidden ? "true" : undefined}>
			<strong>Built for learners everywhere</strong>
			{learningCommunities.map(([name, icon]) => (
				<span className="community-marquee-item" key={name}>
					<CommunityMark type={icon} />
					<span className="community-marquee-name">{name}</span>
				</span>
			))}
		</div>
	);
}

export default async function Page() {
	const currentSession = await getCurrentSession();

	return (
		<main className="marketing-page">
			<MotionEffects />
			<Hero authenticated={Boolean(currentSession)} />
			<section className="community-marquee" aria-label="Examples of learning communities" data-reveal="fade">
				<div className="community-marquee-viewport">
					<div className="community-marquee-track">
						<CommunityGroup />
						<CommunityGroup hidden />
					</div>
				</div>
			</section>
			<NotesDemo />
			<FeatureGrid />
			<BannerCta authenticated={Boolean(currentSession)} />
			<Pricing />
			<Footer />
		</main>
	);
}
