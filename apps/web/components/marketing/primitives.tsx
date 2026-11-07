import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function Band({ id, tone, labelledBy, children }: { id?: string; tone?: "surface" | "fade"; labelledBy?: string; children: ReactNode }) {
	return (
		<section id={id} className={tone ? `ls-band ls-band-${tone}` : "ls-band"} aria-labelledby={labelledBy}>
			<div className="ls-container">{children}</div>
		</section>
	);
}

export function Eyebrow({ href, children }: { href: string; children: ReactNode }) {
	return (
		<p className="ls-eyebrow">
			<a href={href}>
				{children}
				<ChevronRight aria-hidden="true" />
			</a>
		</p>
	);
}

/** A three column row of illustrated feature cards; scrolls horizontally below lg. */
export function CardRow({ children }: { children: ReactNode }) {
	return (
		<div className="ls-frame ls-frame-cards">
			<div className="ls-cards">
				{children}
				<div className="ls-cards-end" aria-hidden="true" />
			</div>
		</div>
	);
}

export function FeatureCard({ title, text, wash, children }: { title: string; text: string; wash: string; children: ReactNode }) {
	return (
		<article className="ls-card">
			<div className={`ls-card-art ls-wash-${wash}`} aria-hidden="true">
				{children}
			</div>
			<p className="ls-card-caption">
				<strong>{title}</strong> {text}
			</p>
		</article>
	);
}
