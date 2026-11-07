import { CalendarDays, Code2, Compass, ListVideo, MessageCircleQuestionMark } from "lucide-react";

import { CalendarCards } from "./Calendar";
import { DiscoveryCards } from "./Discovery";
import { FeatureTabs } from "./FeatureTabs";
import { PlaylistCards } from "./Playlists";
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
		id: "playlists",
		label: "Playlists",
		icon: <ListVideo aria-hidden="true" />,
		title: "A plan for your goal, level and hours.",
		text: "Pick a curated playlist, say where you are and how much time you have. LearnSpace turns it into sprints and days that rebalance as you go.",
		panel: <PlaylistCards />,
	},
	{
		id: "calendar",
		label: "Calendar",
		icon: <CalendarDays aria-hidden="true" />,
		title: "Every study day, remembered.",
		text: "Each day records what you studied, where you were strong and what needs another pass, so you always know what to revisit next.",
		panel: <CalendarCards />,
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
