import type { ReactNode } from "react";

const paths = {
	note: (
		<>
			<rect x="4" y="4" width="16" height="16" rx="2" />
			<path d="M9 4v7l3-2 3 2V4" />
		</>
	),
	brain: (
		<>
			<path d="M12 4c-3-3-6 0-5 3-4 0-4 6-2 7-2 3 1 6 4 5 0 3 3 3 3 0V4Zm0 0c3-3 6 0 5 3 4 0 4 6 2 7 2 3-1 6-4 5 0 3-3 3-3 0" />
			<path d="M7 7v3m-2 4h3m9-7v3m2 4h-3" />
		</>
	),
	flexible: (
		<>
			<path d="m12 2 4 2.5v5L12 12 8 9.5v-5L12 2Zm-6 9 4 2.5v5L6 21l-4-2.5v-5L6 11Zm12 0 4 2.5v5L18 21l-4-2.5v-5L18 11Z" />
			<path d="m8 4.5 4 2.5 4-2.5M12 7v5M2 13.5 6 16l4-2.5M6 16v5m8-7.5 4 2.5 4-2.5M18 16v5" />
		</>
	),
} satisfies Record<string, ReactNode>;

export function MarketingIcon({ name }: { name: keyof typeof paths }) {
	return (
		<svg className="feature-icon" viewBox="0 0 24 24" aria-hidden="true">
			{paths[name]}
		</svg>
	);
}
