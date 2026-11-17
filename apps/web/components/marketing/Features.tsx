import { CalendarDays, Code2, Compass, MessageCircleQuestionMark, Route } from "lucide-react";

import { DiscoveryCards } from "./Discovery";
import { FeatureTabs } from "./FeatureTabs";
import { PathCards } from "./Paths";
import { PlanCards } from "./Plan";
import { PracticeCards } from "./Practice";
import { Band, Eyebrow } from "./primitives";
import { TutorCards } from "./Tutor";

const features = [
	{
		id: "discovery",
		label: "Discovery",
		icon: <Compass aria-hidden="true" />,
		title: "Only what you came to learn.",
		text: "A discovery agent searches YouTube and arXiv for you and keeps only educational content that matches the interests you chose, then keeps tuning to what you watch.",
		panel: <DiscoveryCards />,
	},
	{
		id: "tutor",
		label: "Tutor",
		icon: <MessageCircleQuestionMark aria-hidden="true" />,
		title: "Ask the video. It answers from the lesson.",
		text: "The tutor reads the transcript of whatever you are watching, cites the moment that explains it, and saves every conversation to your study session.",
		panel: <TutorCards />,
	},
	{
		id: "paths",
		label: "Paths",
		icon: <Route aria-hidden="true" />,
		title: "A path for every field, in the right order.",
		text: "Learning paths climb from the concepts you need to the papers that defined each field, with the hours each one really takes.",
		panel: <PathCards />,
	},
	{
		id: "plan",
		label: "Plan",
		icon: <CalendarDays aria-hidden="true" />,
		title: "A plan that fits your week.",
		text: "Set a goal and LearnSpace fills your calendar with what to watch, read and practice, then checks each to-do against what you actually studied.",
		panel: <PlanCards />,
	},
	{
		id: "practice",
		label: "Practice",
		icon: <Code2 aria-hidden="true" />,
		title: "Practice that coaches, never just answers.",
		text: "A quiz after every lesson and a live code editor with a tutor beside you that guides one hint at a time instead of handing over the solution.",
		panel: <PracticeCards />,
	},
];

export function Features() {
	return (
		<Band id="features" labelledBy="features-title">
			<div className="ls-frame ls-section-head is-centered is-fade ls-frame-tight-bottom" data-reveal>
				<Eyebrow href="#features">Features</Eyebrow>
				<h2 className="ls-h2" id="features-title">
					Everything you need to learn,{" "}
					<br />
					in one quiet place.
				</h2>
			</div>
			<FeatureTabs features={features} />
		</Band>
	);
}
