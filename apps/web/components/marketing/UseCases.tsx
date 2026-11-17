import { Briefcase, Code2, GraduationCap, Microscope } from "lucide-react";

import { Band, Eyebrow } from "./primitives";

const cases = [
	[Code2, "Self-taught developers", "Turn a backlog of saved tutorials into a plan you actually finish, with coding practice after every lesson."],
	[GraduationCap, "University students", "Pair lectures with the papers behind them, ask questions mid-video and see what to revise before exams."],
	[Microscope, "Researchers", "Read papers with a tutor that cites the section it is quoting, then move straight to implementing the idea."],
	[Briefcase, "Interview prep", "A study plan sized to the hours you have, with a check after every lesson and coding drills that show where you slipped."],
] as const;

export function UseCases() {
	return (
		<Band id="use-cases" labelledBy="use-cases-title">
			<div className="ls-frame ls-section-head is-centered" data-reveal>
				<Eyebrow href="#use-cases">Use cases</Eyebrow>
				<h2 className="ls-h2" id="use-cases-title">
					Built for the way{" "}
					<br />
					you actually study.
				</h2>
			</div>
			<div className="ls-frame ls-frame-flush">
				<ul className="ls-grid-cells ls-cases">
					{cases.map(([Icon, title, text]) => (
						<li key={title} data-reveal>
							<span className="ls-case-icon">
								<Icon aria-hidden="true" />
							</span>
							<p>
								<strong>{title}</strong> {text}
							</p>
						</li>
					))}
				</ul>
			</div>
		</Band>
	);
}
