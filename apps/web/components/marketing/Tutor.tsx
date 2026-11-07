import { Check, CircleHelp, MessageSquare, Play } from "lucide-react";

import { CardRow, FeatureCard } from "./primitives";

const sessions = [
	["Transformers, lecture 3", "Today", "14"],
	["Linear algebra refresher", "Yesterday", "9"],
	["Backprop by hand", "Monday", "22"],
	["Intro to PyTorch", "Nov 2", "6"],
] as const;

export function TutorCards() {
	return (
		<CardRow>
			<FeatureCard wash="peach" title="Grounded in the transcript" text="Answers come from the lesson itself, with timestamps you can jump to.">
				<div className="ls-bubble">Why do we divide by √dₖ?</div>
				<div className="ls-panel ls-panel-bleed ls-answer">
					<p>
						To keep dot products from growing with dimension. Large scores push softmax into regions with tiny
						gradients.
					</p>
					<div className="ls-stamps">
						<span className="ls-chip">
							<Play />
							12:40
						</span>
						<span className="ls-chip">
							<Play />
							13:05
						</span>
					</div>
				</div>
			</FeatureCard>
			<FeatureCard wash="sky" title="Sessions that persist" text="Pick up any study chat exactly where you left it, with the lesson still in context.">
				<div className="ls-panel ls-panel-float">
					<div className="ls-panel-head">
						<MessageSquare />
						Study sessions
					</div>
					{sessions.map(([title, when, count]) => (
						<div className="ls-row" key={title}>
							<span className="ls-row-text">
								<b>{title}</b>
								<small>{when}</small>
							</span>
							<span className="ls-count">{count}</span>
						</div>
					))}
				</div>
			</FeatureCard>
			<FeatureCard wash="lilac" title="A learning harness" text="Before moving on, the tutor checks that the idea landed instead of just moving forward.">
				<div className="ls-panel ls-panel-float ls-quiz">
					<div className="ls-panel-head">
						<CircleHelp />
						Check before moving on
					</div>
					<p className="ls-quiz-question">A query matches one key strongly. What happens to that value’s weight?</p>
					<span className="ls-option">It shrinks toward zero</span>
					<span className="ls-option is-picked">
						It dominates the output
						<Check />
					</span>
					<span className="ls-option">It stays the same</span>
				</div>
			</FeatureCard>
		</CardRow>
	);
}
