import { Check, ChevronsRight, CirclePlay, CloudUpload, Lightbulb, RotateCcw, Send } from "lucide-react";

import { AppShot, CardRow, FeatureCard } from "./primitives";

// Markup mirrors the app's mastery check (MasteryCheck) and coding workspace (CodingWorkspace), so it renders
// with session.css and coding.css. The editor itself is Monaco in the app; here its lines are drawn in Monaco's
// light theme colours.

const options = ["The first `if` branch", "The `elif` branch", "The `else` branch"];

export function PracticeCards() {
	return (
		<CardRow>
			<FeatureCard wash="mint" title="A check after every lesson" text="Questions written from the video you just watched, with feedback on every answer.">
				<AppShot scope="video-session" className="ls-shot-mastery is-bleed">
					<div className="session-tool">
						<div className="session-panel-bar">
							<button type="button" className="session-icon-button">
								<ChevronsRight />
							</button>
							<h2 className="session-panel-title">Mastery check</h2>
							<div className="session-panel-bar-actions">
								<span className="session-quiz-count">2 / 5</span>
							</div>
						</div>
						<div className="session-tool-body">
							<div className="session-quiz-question">
								<p className="session-quiz-prompt">If it’s neither hot nor cold, which branch handles it?</p>
								<ol className="session-quiz-options">
									{options.map((option, index) => (
										<li key={option}>
											<button type="button" className={index === 2 ? "session-quiz-option is-correct" : "session-quiz-option"}>
												<span>{String.fromCharCode(65 + index)}</span>
												<span className="session-quiz-option-text">{option}</span>
												{index === 2 ? <Check /> : null}
											</button>
										</li>
									))}
								</ol>
								<div className="session-quiz-feedback">
									<strong>Correct</strong>
									<p>When no earlier condition is true, Python runs the `else` block.</p>
								</div>
							</div>
						</div>
					</div>
				</AppShot>
			</FeatureCard>
			<FeatureCard wash="sky" title="A real code editor" text="Write and run code in the browser, then submit it against hidden tests.">
				<AppShot scope="coding-workspace" className="ls-shot-editor is-bleed is-flush">
					<section className="coding-main">
						<div className="coding-editor-bar">
							<select defaultValue="python">
								<option value="python">Python</option>
							</select>
							<button type="button" className="coding-ghost">
								<RotateCcw />
							</button>
							<span className="coding-spacer" />
							<button type="button" className="coding-run">
								<CirclePlay />
								Run
							</button>
							<button type="button" className="coding-submit">
								<CloudUpload />
								Submit
							</button>
						</div>
						<pre className="ls-code">
							<code>
								<span className="ls-code-ln">1</span>
								<span className="ls-code-kw">class</span> <span className="ls-code-fn">Solution</span>:{"\n"}
								<span className="ls-code-ln">2</span>
								{"    "}
								<span className="ls-code-kw">def</span> <span className="ls-code-fn">phoneNumbers</span>(self, names, numbers, queries):{"\n"}
								<span className="ls-code-ln">3</span>
								{"        "}contacts = <span className="ls-code-fn">dict</span>(<span className="ls-code-fn">zip</span>(names, numbers)){"\n"}
								<span className="ls-code-ln">4</span>
								{"        "}
								<span className="ls-code-kw">return</span> [contacts.get(name, <span className="ls-code-str">""</span>){" "}
								<span className="ls-code-kw">for</span> name <span className="ls-code-kw">in</span> queries]
							</code>
						</pre>
					</section>
				</AppShot>
			</FeatureCard>
			<FeatureCard wash="sun" title="Hints that cost a little" text="The tutor answers with questions first; each hint you take lowers the most the problem can earn.">
				<AppShot scope="coding-workspace" className="ls-shot-tutor is-bleed is-flush">
					<aside className="coding-tutor">
						<div className="coding-tutor-head">
							<strong>
								<span className="coding-live is-on" />
								Tutor
							</strong>
							<span className="coding-credit">Max credit 100%</span>
						</div>
						<div className="coding-feed">
							<div className="coding-turn is-learner">
								<div>
									<p>i dont know how to solve this</p>
								</div>
							</div>
							<div className="coding-turn is-tutor">
								<div>
									<p>
										Each name and its phone number are paired by their index in the two arrays. For a query, what should the result be if you
										can’t find that name in <code>names</code>?
									</p>
								</div>
							</div>
						</div>
						<form className="coding-ask">
							<textarea rows={2} placeholder="Answer the tutor..." />
							<button type="button">
								<Send />
							</button>
						</form>
						<div className="coding-hint-bar">
							<button type="button" className="coding-ghost">
								<Lightbulb />
								Hint 1 <small>→ max 80%</small>
							</button>
						</div>
					</aside>
				</AppShot>
			</FeatureCard>
		</CardRow>
	);
}
