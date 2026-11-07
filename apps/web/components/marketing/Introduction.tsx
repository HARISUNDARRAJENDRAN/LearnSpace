import { LearningLoop } from "./LearningLoop";
import { Eyebrow } from "./primitives";

export function Introduction() {
	return (
		<section className="ls-band" id="introduction" aria-label="Introducing LearnSpace">
			<div className="ls-container">
				<div className="ls-frame ls-intro">
					<div className="ls-intro-label">
						<Eyebrow href="#features">Introducing LearnSpace</Eyebrow>
					</div>
					<div className="ls-intro-copy" data-reveal>
						<p className="ls-lead">
							<strong>Learning online is broken.</strong> Every lesson sits one click away from a hundred
							distractions, answers arrive without context, and what you studied last week is gone by the next.
						</p>
						<p className="ls-lead">
							<strong>LearnSpace is a study space that keeps the thread.</strong> It finds the lessons worth your
							time, tutors you inside them, plans what comes next, and remembers everything you have learned.
						</p>
					</div>
				</div>
				<div className="ls-frame ls-loop-frame">
					<p className="ls-loop-title">One loop, from first lesson to lasting knowledge</p>
					<LearningLoop />
				</div>
			</div>
		</section>
	);
}
