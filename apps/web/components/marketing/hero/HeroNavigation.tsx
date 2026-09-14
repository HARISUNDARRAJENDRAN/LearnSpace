"use client";

import { useEffect, useState } from "react";

export function HeroNavigation({ authenticated = false }: { authenticated?: boolean }) {
	const appHref = authenticated ? "/app" : "/register";
	const appLabel = authenticated ? "Open LearnSpace" : "Start learning";
	const [isScrolled, setIsScrolled] = useState(false);
	const [isMenuOpen, setIsMenuOpen] = useState(false);

	useEffect(() => {
		const handleScroll = () => setIsScrolled(window.scrollY > 24);
		handleScroll();
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	useEffect(() => {
		const closeMenu = () => setIsMenuOpen(false);
		window.addEventListener("hashchange", closeMenu);
		return () => window.removeEventListener("hashchange", closeMenu);
	}, []);

	return (
		<header className={`hero-navigation${isScrolled ? " is-scrolled" : ""}`}>
			<nav className="hero-navbar" aria-label="Primary navigation">
				<a className="hero-navbar-brand" href="#hero" aria-label="LearnSpace home">
					<span className="hero-wordmark">
						<img className="hero-brand-monogram" src="/assets/learnspace-monogram.svg" width="28" height="28" alt="" />
						<span className="hero-brand-lettering">Learnspace</span>
					</span>
				</a>
				<div className="hero-navbar-links">
					<a href="#how-it-works">How it works</a>
					<a href="#features">Features</a>
					<a href="#pricing">Pricing</a>
				</div>
				<div className="hero-navbar-actions">
					{authenticated ? null : <a className="hero-navbar-login" href="/login">Log in</a>}
					<a className="hero-navbar-cta" href={appHref}>{appLabel}</a>
				</div>
				<div className="hero-navbar-mobile-menu">
					<button
						type="button"
						className="hero-navbar-menu-toggle"
						aria-label="Toggle navigation"
						aria-expanded={isMenuOpen}
						aria-controls="hero-mobile-menu"
						onClick={() => setIsMenuOpen((open) => !open)}
					>
						<span />
						<span />
						<span />
					</button>
					<div
						id="hero-mobile-menu"
						className={`hero-navbar-mobile-links${isMenuOpen ? " is-open" : ""}`}
						aria-hidden={!isMenuOpen}
					>
						<a href="#how-it-works">How it works</a>
						<a href="#features">Features</a>
						<a href="#pricing">Pricing</a>
						{authenticated ? null : <a href="/login">Log in</a>}
					</div>
				</div>
			</nav>
		</header>
	);
}
