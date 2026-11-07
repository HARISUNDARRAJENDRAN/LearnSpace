import { Check, Lightbulb, Lock, X } from "lucide-react";

import { CardRow, FeatureCard } from "./primitives";

export function PracticeCards() {
	return (
		<CardRow>
			<FeatureCard wash="mint" title="Quiz after every lesson" text="Short checks written from the video you just watched.">
				<div className="ls-panel ls-panel-float ls-quiz">
					<div className="ls-panel-head">Question 2 of 5</div>
					<p className="ls-quiz-question">What is the shape of q · kᵀ for 8 tokens?</p>
					<span className="ls-option is-wrong">
						8 × 64
						<X />
					</span>
					<span className="ls-option is-picked">
						8 × 8
						<Check />
					</span>
				</div>
			</FeatureCard>
			<FeatureCard wash="sky" title="Live code editor" text="Write and run real code in the browser, checked against hidden tests.">
				<div className="ls-editor">
					<div className="ls-editor-tab">attention.py</div>
					<pre>
						<code>
							<span className="ls-ln">1</span>
							<span className="ls-kw">def</span> <span className="ls-fn">attention</span>(q, k, v):{"\n"}
							<span className="ls-ln">2</span>
							{"    "}d = k.shape[<span className="ls-num">-1</span>]{"\n"}
							<span className="ls-ln">3</span>
							{"    "}s = q @ k.T / <span className="ls-fn">sqrt</span>(d){"\n"}
							<span className="ls-ln">4</span>
							{"    "}<span className="ls-kw">return</span> <span className="ls-fn">softmax</span>(s) @ v<span className="ls-caret" />
						</code>
					</pre>
					<div className="ls-editor-tests">
						<span className="is-pass">
							<Check />3 passed
						</span>
						<span className="is-fail">
							<X />1 failing
						</span>
					</div>
				</div>
			</FeatureCard>
			<FeatureCard wash="sun" title="Hints, one rung at a time" text="The tutor nudges you toward the answer and saves the full solution for last.">
				<div className="ls-ladder">
					<span className="ls-hint is-used">
						<Lightbulb />
						Hint 1: Check which axis softmax runs over
					</span>
					<span className="ls-hint is-current">
						<Lightbulb />
						Hint 2: Each row should sum to one. Does yours?
					</span>
					<span className="ls-hint is-locked">
						<Lock />
						Show the solution
					</span>
				</div>
			</FeatureCard>
		</CardRow>
	);
}
