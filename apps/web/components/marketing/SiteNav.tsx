"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

const links = [
	["Features", "#features"],
	["Use cases", "#use-cases"],
	["Pricing", "#pricing"],
] as const;

export function Logo() {
	return (
		<a className="ls-logo" href="/" aria-label="LearnSpace home">
			<img src="/assets/learnspace-monogram.svg" width="28" height="28" alt="" />
			<span>LearnSpace</span>
		</a>
	);
}

/**
 * The hero renders the inline nav; `sticky` renders the white copy that slides in
 * once the inline nav has scrolled out of view.
 */
export function SiteNav({ authenticated, sticky = false }: { authenticated: boolean; sticky?: boolean }) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [shown, setShown] = useState(!sticky);

	useEffect(() => {
		if (!sticky) return;
		const inlineNav = document.querySelector("[data-inline-nav]");
		if (!inlineNav) return;
		const observer = new IntersectionObserver(([entry]) => {
			if (!entry) return;
			setShown(!entry.isIntersecting);
			if (entry.isIntersecting) setMenuOpen(false);
		});
		observer.observe(inlineNav);
		return () => observer.disconnect();
	}, [sticky]);

	const appHref = authenticated ? "/app" : "/register";
	const appLabel = authenticated ? "Open LearnSpace" : "Start learning";
	const className = sticky ? `ls-nav ls-nav-sticky${shown ? " is-shown" : ""}` : "ls-nav";

	return (
		<header className={className} data-inline-nav={sticky ? undefined : ""} inert={sticky && !shown ? true : undefined}>
			<nav className="ls-nav-bar" aria-label={sticky ? "Primary (sticky)" : "Primary"}>
				<Logo />
				<ul className="ls-nav-links">
					{links.map(([label, href]) => (
						<li key={href}>
							<a href={href}>{label}</a>
						</li>
					))}
				</ul>
				<div className="ls-nav-actions">
					{authenticated ? null : (
						<a className="ls-nav-login" href="/login">
							Log in
						</a>
					)}
					<a className="ls-btn" href={appHref}>
						{appLabel}
					</a>
				</div>
				<button
					type="button"
					className="ls-nav-toggle"
					aria-label={menuOpen ? "Close menu" : "Open menu"}
					aria-expanded={menuOpen}
					onClick={() => setMenuOpen((open) => !open)}
				>
					{menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
				</button>
			</nav>
			{menuOpen ? (
				<div className="ls-nav-menu">
					{links.map(([label, href]) => (
						<a key={href} href={href} onClick={() => setMenuOpen(false)}>
							{label}
						</a>
					))}
					{authenticated ? null : <a href="/login">Log in</a>}
					<a className="ls-btn" href={appHref}>
						{appLabel}
					</a>
				</div>
			) : null}
		</header>
	);
}
