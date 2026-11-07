import { CalendarClock, Code2, FileText, RotateCcw, TrendingDown, TrendingUp } from "lucide-react";

import { CardRow, FeatureCard } from "./primitives";

// Study intensity (0–3) for November 1–12; later days are still ahead.
const activity = [1, 2, 0, 3, 2, 1, 0, 2, 3, 3, 1, 2];
const today = 12;

const revisits = [
	[RotateCcw, "Review softmax stability", "10 min"],
	[Code2, "Retry scaled attention", "15 min"],
	[FileText, "Re-read Attention, §3.2", "8 min"],
] as const;

export function CalendarCards() {
	return (
		<CardRow>
			<FeatureCard wash="sky" title="Every study day, recorded" text="Each day keeps the lessons, papers, chats and exercises you worked through.">
				<div className="ls-panel ls-panel-float ls-month">
					<div className="ls-month-head">
						<b>November 2026</b>
						<small>{activity.filter(Boolean).length} study days</small>
					</div>
					<div className="ls-month-grid">
						{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: weekday initials repeat
							<small key={index}>{day}</small>
						))}
						{Array.from({ length: 30 }, (_, index) => {
							const date = index + 1;
							const level = activity[index] ?? -1;
							const className = ["ls-day", level >= 0 ? `is-level-${level}` : "is-ahead", date === today ? "is-today" : ""].join(" ");
							return (
								<span className={className} key={date} style={{ animationDelay: `${240 + index * 14}ms` }}>
									{date}
								</span>
							);
						})}
					</div>
				</div>
			</FeatureCard>
			<FeatureCard wash="mint" title="Strong points and weak spots" text="Quiz results and code attempts show what has stuck and what still wobbles.">
				<div className="ls-panel ls-panel-float ls-day-detail">
					<div className="ls-month-head">
						<b>Thursday, November 12</b>
						<small>1 h 54 min</small>
					</div>
					<small className="ls-detail-label">Strong</small>
					<span className="ls-chip ls-chip-success">
						<TrendingUp />
						Matrix multiplication
					</span>
					<span className="ls-chip ls-chip-success">
						<TrendingUp />
						Dot products
					</span>
					<small className="ls-detail-label">Needs another pass</small>
					<span className="ls-chip ls-chip-warning">
						<TrendingDown />
						Softmax numerical stability
					</span>
				</div>
			</FeatureCard>
			<FeatureCard wash="peach" title="Revisit at the right time" text="Weak concepts come back on your calendar before you forget them.">
				<div className="ls-bubble">What should I review this weekend?</div>
				<div className="ls-panel ls-panel-bleed">
					<div className="ls-panel-head">
						<CalendarClock />
						Saturday, November 14
					</div>
					{revisits.map(([Icon, title, length]) => (
						<div className="ls-row" key={title}>
							<span className="ls-row-text">
								<b>{title}</b>
								<small>
									<Icon />
									{length}
								</small>
							</span>
						</div>
					))}
				</div>
			</FeatureCard>
		</CardRow>
	);
}
