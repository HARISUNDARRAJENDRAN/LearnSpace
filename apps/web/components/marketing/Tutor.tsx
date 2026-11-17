import { CalendarDays, ChevronRight, Code, Ellipsis, ListChecks, MessagesSquare, NotebookPen, Play, Workflow } from "lucide-react";

import { AppShot, CardRow, FeatureCard } from "./primitives";

// Markup mirrors the app's study chat (TutorBlocks, SessionChat) and sidebar (application nav), so the
// panels render with session.css and application.css.

const cites = ["58:04", "59:04", "1:00:04"];

const parts = [
	[Workflow, "Learning Canvas"],
	[NotebookPen, "AI Notes"],
	[MessagesSquare, "AI Chat"],
	[Code, "Code Exercises"],
	[ListChecks, "Practice & Quizzes"],
] as const;

export function TutorCards() {
	return (
		<CardRow>
			<FeatureCard wash="peach" title="Grounded in the transcript" text="Answers come from the lesson itself, with the moments you can jump back to.">
				<AppShot scope="video-session" className="ls-shot-chat is-bleed">
					<div className="chat-messages">
						<article className="chat-message is-user">
							<button type="button" className="chat-context-chip">
								<Play />
								1:00
							</button>
							<p className="chat-bubble">Briefly explain the main idea in one paragraph.</p>
						</article>
						<article className="chat-message is-assistant">
							<div className="tutor-answer">
								<div className="tutor-block">
									<div className="tutor-text">
										<p>
											<strong>If statements</strong> let a program decide: when a condition is true it runs the matching code,
											otherwise it takes another path.
										</p>
										<span className="tutor-cites">
											{cites.map((time) => (
												<button type="button" className="tutor-cite" key={time}>
													<Play />
													{time}
												</button>
											))}
										</span>
									</div>
								</div>
							</div>
						</article>
					</div>
				</AppShot>
			</FeatureCard>
			<FeatureCard wash="sky" title="Sessions that persist" text="Every lesson keeps its canvas, notes, chat and practice together, right where you left them.">
				<AppShot scope="application-page" className="ls-shot-sidebar is-bleed">
					<nav className="application-nav">
						<div className="application-nav-section">
							<p className="application-nav-label">WORKSPACE</p>
							<div className="application-sessions is-open">
								<div className="application-nav-row">
									<span className="application-nav-link" data-nav-tone="sessions">
										<span className="application-nav-icon">
											<CalendarDays />
										</span>
										<span>Sessions</span>
									</span>
								</div>
								<ul className="application-session-tree">
									<li className="application-session is-active">
										<div className="application-session-row">
											<button type="button" className="application-session-toggle" aria-expanded="true">
												<ChevronRight />
											</button>
											<span className="application-session-link">
												<span>Python Full Course for Beginners</span>
											</span>
											<button type="button" className="application-session-more">
												<Ellipsis />
											</button>
										</div>
										<ul className="application-session-parts">
											{parts.map(([Icon, label]) => (
												<li key={label}>
													<span className={label === "AI Chat" ? "application-session-part is-active" : "application-session-part"}>
														<Icon />
														<span>{label}</span>
													</span>
												</li>
											))}
										</ul>
									</li>
									{["Attention Is All You Need", "Machine Learning Fundamentals"].map((title) => (
										<li className="application-session" key={title}>
											<div className="application-session-row">
												<button type="button" className="application-session-toggle" aria-expanded="false">
													<ChevronRight />
												</button>
												<span className="application-session-link">
													<span>{title}</span>
												</span>
											</div>
										</li>
									))}
								</ul>
							</div>
						</div>
					</nav>
				</AppShot>
			</FeatureCard>
			<FeatureCard wash="lilac" title="Checks that it landed" text="Mid-conversation, the tutor asks a quick question to make sure the idea stuck before moving on.">
				<AppShot scope="video-session" className="ls-shot-check is-bleed">
					<section className="tutor-card tutor-check">
						<span className="tutor-eyebrow">Check your understanding</span>
						<p className="tutor-prompt">If it’s neither hot nor cold, which branch handles it?</p>
						<ol className="session-quiz-options">
							{["The first `if` branch", "The `elif` branch", "The `else` branch"].map((option, index) => (
								<li key={option}>
									<button type="button" className="session-quiz-option">
										<span>{String.fromCharCode(65 + index)}</span>
										<span className="session-quiz-option-text">{option}</span>
									</button>
								</li>
							))}
						</ol>
					</section>
				</AppShot>
			</FeatureCard>
		</CardRow>
	);
}
