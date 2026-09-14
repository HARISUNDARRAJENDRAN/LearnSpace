export type FeatureConcept = "context" | "research" | "tutor" | "practice" | "mastery" | "discovery";

const artwork = {
	context: { file: "features-reference-v2", viewBox: "36 28 712 475", width: 1516, height: 1037 },
	research: { file: "features-reference-v2", viewBox: "768 27 712 476", width: 1516, height: 1037 },
	tutor: { file: "feature-tutor-v2", viewBox: "0 0 1536 1024", width: 1536, height: 1024 },
	practice: { file: "features-reference-v2", viewBox: "36 520 712 478", width: 1516, height: 1037 },
	mastery: { file: "features-reference-v2", viewBox: "768 520 712 478", width: 1516, height: 1037 },
	discovery: { file: "feature-discovery-v2", viewBox: "0 0 1536 1024", width: 1536, height: 1024 },
} satisfies Record<FeatureConcept, { file: string; viewBox: string; width: number; height: number }>;

export function FeatureIllustration({ concept }: { concept: FeatureConcept }) {
	const { file, viewBox, width, height } = artwork[concept];
	return (
		<svg
			className={`feature-illustration feature-illustration-${concept}`}
			viewBox={viewBox}
			preserveAspectRatio="xMidYMid slice"
			aria-hidden="true"
			focusable="false"
		>
			<image href={`/assets/marketing/${file}.webp`} width={width} height={height} />
		</svg>
	);
}
