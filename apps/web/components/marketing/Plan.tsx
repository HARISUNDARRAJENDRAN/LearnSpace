import { Check, ChevronUp, ListFilter, Plus } from "lucide-react";
import type { CSSProperties } from "react";

import { Medal } from "../home/Medal";
import { AppShot, CardRow, FeatureCard } from "./primitives";

// Markup mirrors the app's Home calendar (TimeGrid, PlanSidebar) and level card, so it renders with home.css.

const hour = 56;
const days = [
	["17", "Tue"],
	["18", "Wed"],
] as const;

// [day index, start in hours after 5 PM, length in hours, kind, tone, time, title, progress]
const events = [
	[0, 0.1, 1.15, "watch", "done is-past", "5:05 PM", "If statements", 0],
	[0, 1.4, 1.3, "read", "active", "6:25 PM", "Attention paper", 40],
	[1, 0.3, 1.3, "practice", "planned", "5:20 PM", "Contact lookup", 0],
	[1, 1.75, 1.15, "review", "planned", "6:45 PM", "Conditionals", 0],
] as const;

const todos = [
	["watch", "done", "Watch Python, if statements", "Watch"],
	["read", "active", "Finish the Attention paper", "Read · 40%"],
	["practice", "planned", "Practice: contact lookup", "Practice"],
] as const;

export function PlanCards() {
	return (
		<CardRow>
			<FeatureCard wash="sky" title="Your week, planned" text="Tell LearnSpace your goal and it places what to watch, read and practice on your calendar.">
				<AppShot scope="home-page plan-calendar" className="ls-shot-week is-bleed">
					<div className="plan-grid" style={{ "--plan-days": days.length, "--plan-hour": `${hour}px`, "--plan-axis": "44px" } as CSSProperties}>
						<div className="plan-grid-row plan-grid-head">
							<div className="plan-axis-cell" />
							{days.map(([date, name]) => (
								<button type="button" className={date === "17" ? "plan-day-head is-today" : "plan-day-head"} key={date}>
									<b>{date}</b>
									<span>{name}</span>
								</button>
							))}
						</div>
						<div className="plan-grid-body" style={{ height: hour * 4 }}>
							<div className="plan-axis">
								{["6 PM", "7 PM", "8 PM"].map((label, index) => (
									<span key={label} style={{ top: (index + 1) * hour }}>
										{label}
									</span>
								))}
							</div>
							{days.map(([date], dayIndex) => (
								<div className={date === "17" ? "plan-day-col is-today" : "plan-day-col"} key={date}>
									{events
										.filter(([day]) => day === dayIndex)
										.map(([, start, length, kind, tone, time, title, progress]) => (
											<button
												type="button"
												className={`plan-event kind-${kind} is-${tone} is-compact`}
												key={title}
												style={{ top: start * hour, height: length * hour - 4, left: 3, width: "calc(100% - 6px)" }}
											>
												<span className="plan-event-meta">
													<i className="plan-dot" />
													<time>{time}</time>
												</span>
												<b>{title}</b>
												{progress ? <i className="plan-event-progress" style={{ width: `${progress}%` }} /> : null}
											</button>
										))}
								</div>
							))}
						</div>
					</div>
				</AppShot>
			</FeatureCard>
			<FeatureCard wash="mint" title="To-dos that check themselves" text="A tick only sticks when your study backs it up, and progress fills in as you watch and read.">
				<AppShot scope="home-page plan-calendar" className="ls-shot-todo is-bleed">
					<aside className="plan-side">
						<div className="plan-side-head">
							<h3>Today</h3>
							<button type="button" className="plan-icon-button">
								<ListFilter />
							</button>
						</div>
						<div className="plan-side-tabs" role="tablist">
							<button type="button" role="tab" aria-selected="true">
								To-do list
							</button>
							<button type="button" role="tab" aria-selected="false">
								Events
							</button>
						</div>
						<section className="plan-side-group">
							<div className="plan-side-group-head">
								<button type="button" className="plan-side-toggle">
									<ChevronUp />
									Today<span>{todos.length}</span>
								</button>
								<button type="button" className="plan-side-add">
									<Plus />
								</button>
							</div>
							<ul>
								{todos.map(([kind, tone, title, when]) => (
									<li key={title}>
										<div className={`plan-todo kind-${kind} is-${tone}`}>
											<button type="button" className="plan-todo-box">
												{tone === "done" ? <Check /> : null}
											</button>
											<button type="button" className="plan-todo-copy">
												<span>{title}</span>
												<small>{when}</small>
											</button>
										</div>
									</li>
								))}
							</ul>
						</section>
					</aside>
				</AppShot>
			</FeatureCard>
			<FeatureCard wash="peach" title="Every study day counts" text="Watching, reading and practice earn XP, and steady days build a streak toward the next rank.">
				<AppShot scope="home-page" className="ls-shot-level is-bleed">
					<section className="home-card home-level">
						<div className="profile-level-summary">
							<div className="home-level-hero">
								<Medal rank="Bronze" />
								<div>
									<p className="home-level-rank">Bronze</p>
									<h3>Level 4</h3>
									<p className="home-level-xp">
										<b>640</b> XP total · 360 XP to Silver
									</p>
								</div>
							</div>
							<dl className="home-level-stats">
								{[
									["Today", "+45"],
									["Last 7 days", "+310"],
									["Streak bonus", "20"],
								].map(([label, value]) => (
									<div key={label}>
										<dt>{label}</dt>
										<dd>{value}</dd>
									</div>
								))}
							</dl>
						</div>
					</section>
				</AppShot>
			</FeatureCard>
		</CardRow>
	);
}
