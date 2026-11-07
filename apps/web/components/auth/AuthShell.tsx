import type { ReactNode } from "react";

import { Logo } from "../marketing/SiteNav";
import { Sky } from "../marketing/Sky";

/** A single white card floating on the landing page's sky. */

export function AuthShell({
	children,
	title,
	subtitle,
	className,
}: {
	children: ReactNode;
	title: string;
	subtitle: string;
	className?: string;
}) {
	return (
		<main className={`auth-page${className ? ` ${className}` : ""}`}>
			<div className="auth-sky">
				<Sky id="auth-sky" />
				<header className="auth-header">
					<Logo />
				</header>
				<section className="auth-card" aria-labelledby="auth-title">
					<h1 id="auth-title">{title}</h1>
					<p className="auth-subtitle">{subtitle}</p>
					{children}
				</section>
			</div>
		</main>
	);
}
