"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronLeftIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type AuthPageProps = {
	children: ReactNode;
	title: string;
	subtitle: string;
	className?: string;
};

export function AuthPage({ children, title, subtitle, className }: AuthPageProps) {
	return (
		<main className={cn("auth-page", className)}>
			<div className="auth-page-grid">
				<aside className="auth-page-visual" aria-label="LearnSpace introduction">
					<div className="auth-page-visual-wash" aria-hidden="true" />
					<a className="auth-page-brand" href="/" aria-label="LearnSpace home">
						<img
							className="auth-page-brand-icon"
							src="/assets/learnspace-monogram.svg"
							width="22"
							height="22"
							alt=""
						/>
						<span>LearnSpace</span>
					</a>
					<div className="auth-page-quote">
						<p>“LearnSpace has helped me to save time and serve my clients faster than ever before.”</p>
						<footer>~ Ali Hassan</footer>
					</div>
					<div className="auth-page-paths" aria-hidden="true">
						<FloatingPaths position={1} />
						<FloatingPaths position={-1} />
					</div>
				</aside>

				<section className="auth-page-main" aria-labelledby="auth-title">
					<div className="auth-page-atmosphere" aria-hidden="true" />
					<a className="auth-page-home" href="/">
						<ChevronLeftIcon aria-hidden="true" />
						<span>Home</span>
					</a>
					<div className="auth-page-content">
						<div className="auth-card-heading">
							<h1 id="auth-title">{title}</h1>
							<p>{subtitle}</p>
						</div>
						{children}
						<p className="auth-legal">
							By clicking continue, you agree to our{" "}
							<a href="/terms">Terms of Service</a> and{" "}
							<a href="/privacy">Privacy Policy</a>.
						</p>
					</div>
				</section>
			</div>
		</main>
	);
}

function FloatingPaths({ position }: { position: number }) {
	const paths = Array.from({ length: 36 }, (_, index) => ({
		id: index,
		d: `M-${380 - index * 5 * position} -${189 + index * 6}C-${380 - index * 5 * position} -${189 + index * 6} -${312 - index * 5 * position} ${216 - index * 6} ${152 - index * 5 * position} ${343 - index * 6}C${616 - index * 5 * position} ${470 - index * 6} ${684 - index * 5 * position} ${875 - index * 6} ${684 - index * 5 * position} ${875 - index * 6}`,
		width: 0.5 + index * 0.03,
	}));

	return (
		<div className="auth-floating-paths">
      <svg viewBox="0 0 696 316" fill="none">
				<title>Background Paths</title>
				{paths.map((path) => (
					<motion.path
						key={path.id}
						d={path.d}
						stroke="currentColor"
						strokeWidth={path.width}
						strokeOpacity={0.1 + path.id * 0.03}
						initial={{ pathLength: 1, opacity: 0.6 }}
						animate={{ pathLength: 1, opacity: 0.6 }}
						transition={{ duration: 0 }}
					/>
				))}
			</svg>
		</div>
	);
}
