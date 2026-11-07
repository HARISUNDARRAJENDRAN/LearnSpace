import { CheckCircle2, Circle, Code2, FileText, Play, RotateCcw } from "lucide-react";

import { CardRow, FeatureCard } from "./primitives";

const genres = [
	["Machine learning", "48 lessons", "sky"],
	["Web development", "36 lessons", "peach"],
	["Data structures", "40 lessons", "mint"],
	["Systems design", "28 lessons", "lilac"],
] as const;

const sprints = [
	["Sprint 1", "Foundations", 100],
	["Sprint 2", "Attention", 60],
	["Sprint 3", "Build a GPT", 0],
] as const;

const day = [
	[Play, "Transformers, lecture 3", "32 min", true],
	[FileText, "Attention Is All You Need, §3", "25 min", true],
	[Code2, "Implement scaled attention", "20 min", false],
	[RotateCcw, "Review softmax", "10 min", false],
] as const;

export function PlaylistCards() {
	return (
		<CardRow>
			<FeatureCard wash="sun" title="Playlists for every genre" text="Hand-curated paths across programming, math, science and more, refreshed regularly.">
				<div className="ls-genres">
					{genres.map(([name, count, tone]) => (
						<div className="ls-genre" key={name}>
							<span className={`ls-genre-cover ls-wash-${tone}`} />
							<b>{name}</b>
							<small>{count}</small>
						</div>
					))}
				</div>
			</FeatureCard>
			<FeatureCard wash="mint" title="Sprints that build on each other" text="Your plan is split into sprints, each one ending with what the next one needs.">
				<div className="ls-panel ls-panel-float">
					<div className="ls-panel-head">ML engineer · 6 weeks</div>
					{sprints.map(([label, name, progress]) => (
						<div className="ls-sprint" key={label}>
							<span className="ls-sprint-label">
								<small>{label}</small>
								<b>{name}</b>
							</span>
							<span className="ls-meter-track">
								<i style={{ width: `${progress}%` }} />
							</span>
							<small className="ls-sprint-state">{progress === 100 ? "Done" : progress ? `${progress}%` : "Next"}</small>
						</div>
					))}
				</div>
			</FeatureCard>
			<FeatureCard wash="sky" title="Days sized to your schedule" text="Every sprint breaks into days that fit the hours you said you have.">
				<div className="ls-panel ls-panel-bleed">
					<div className="ls-panel-head">Day 9 · 90 min</div>
					{day.map(([Icon, title, length, done]) => (
						<div className={done ? "ls-row is-done" : "ls-row"} key={title}>
							{done ? <CheckCircle2 className="ls-row-check" /> : <Circle className="ls-row-check" />}
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
