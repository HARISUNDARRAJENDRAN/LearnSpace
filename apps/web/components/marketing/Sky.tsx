/** Procedural sky: a vertical gradient with fractal-noise clouds gathered toward the upper right.
 * `id` prefixes the SVG defs so the sky can render more than once per page. */
export function Sky({ id }: { id: string }) {
	return (
		<svg className="ls-sky" viewBox="0 0 1440 960" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
			<defs>
				<linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#83dcf5" />
					<stop offset="0.45" stopColor="#b8eaf8" />
					<stop offset="1" stopColor="#e1f6fc" />
				</linearGradient>
				<filter id={`${id}-clouds`} x="0" y="0" width="100%" height="100%">
					<feTurbulence type="fractalNoise" baseFrequency="0.0026 0.0062" numOctaves="5" seed="11" />
					<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3.2 0 0 0 -1.35" />
					<feGaussianBlur stdDeviation="2.5" />
				</filter>
				<radialGradient id={`${id}-focus`} cx="0.78" cy="0.18" r="0.75">
					<stop offset="0" stopColor="#fff" />
					<stop offset="0.55" stopColor="#fff" stopOpacity="0.55" />
					<stop offset="1" stopColor="#fff" stopOpacity="0.16" />
				</radialGradient>
				<mask id={`${id}-mask`}>
					<rect width="1440" height="960" fill={`url(#${id}-focus)`} />
				</mask>
			</defs>
			<rect width="1440" height="960" fill={`url(#${id}-fill)`} />
			<rect width="1440" height="960" filter={`url(#${id}-clouds)`} mask={`url(#${id}-mask)`} />
		</svg>
	);
}
