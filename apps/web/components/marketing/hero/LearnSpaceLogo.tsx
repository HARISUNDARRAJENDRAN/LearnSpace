export function LearnSpaceLogo({ tone = "light" }: { tone?: "light" | "dark" }) {
	return (
		<span className={`brand-lockup ${tone === "dark" ? "brand-lockup-dark" : ""}`}>
			<img
				className="learnspace-mark"
				src="/assets/learnspace-mark.svg"
				alt=""
			/>
			<span className="brand-name">LearnSpace</span>
		</span>
	);
}
