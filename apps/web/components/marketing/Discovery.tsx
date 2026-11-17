import { Bookmark, BookmarkCheck, Ellipsis } from "lucide-react";

import { AppShot, CardRow, FeatureCard } from "./primitives";

// The markup and classes below mirror the app's own Discover and Research components, so these panels
// render with the app's real stylesheets (discover.css, research.css) instead of a drawing of them.

function LessonCard({ image, channel, length, title, reason }: { image: string; channel: string; length: string; title: string; reason: string }) {
	return (
		<article className="discovery-card">
			<img className="discovery-card-image" src={image} alt="" width={640} height={400} loading="lazy" />
			<div className="discovery-card-content">
				<div className="discovery-card-meta">
					<span>{channel}</span>
					<span>{length}</span>
				</div>
				<h3>{title}</h3>
				<p className="discovery-card-reason">{reason}</p>
				<div className="discovery-card-actions">
					<button type="button" className="discovery-start-button">Start learning</button>
					<button type="button" className="discovery-bookmark-button">
						<Bookmark size={18} strokeWidth={1.8} />
					</button>
				</div>
			</div>
		</article>
	);
}

const papers = [
	{
		initials: "AV",
		tone: 2,
		author: "Ashish Vaswani",
		others: 7,
		date: "Jun 12, 2017",
		year: 2017,
		title: "Attention Is All You Need",
		authors: "Ashish Vaswani, Noam Shazeer, Niki Parmar",
		minutes: 15,
		saved: true,
		abstract:
			"The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
	},
	{
		initials: "JD",
		tone: 4,
		author: "Jacob Devlin",
		others: 3,
		date: "Oct 11, 2018",
		year: 2018,
		title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
		authors: "Jacob Devlin, Ming-Wei Chang, Kenton Lee",
		minutes: 12,
		saved: false,
		abstract:
			"We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers. BERT is designed to pre-train deep bidirectional representations from unlabeled text.",
	},
];

function PaperRow({ paper }: { paper: (typeof papers)[number] }) {
	return (
		<article className="research-paper-row">
			<div className="research-paper-copy">
				<div className="research-paper-byline">
					<span className="research-author-link">
						<span className={`research-avatar research-avatar-${paper.tone} is-small`}>{paper.initials}</span>
						<span>{paper.author}</span>
					</span>
					<span>+{paper.others}</span>
					<time>{paper.date}</time>
					<span className="research-paper-venue">arXiv</span>
				</div>
				<button type="button" className="research-paper-title">{paper.title}</button>
				<p className="research-paper-excerpt">{paper.abstract}</p>
				<div className="research-paper-footer">
					<span className="research-concept-chip">AI / Machine Learning</span>
					<span>{paper.minutes} min read</span>
					<span className="research-paper-actions">
						<button type="button" className="research-icon-button">{paper.saved ? <BookmarkCheck /> : <Bookmark />}</button>
						<button type="button" className="research-icon-button">
							<Ellipsis />
						</button>
					</span>
				</div>
			</div>
			<div className="research-paper-page">
				<span className="research-paper-page-meta">arXiv · {paper.year}</span>
				<span className="research-paper-page-title">{paper.title}</span>
				<span className="research-paper-page-authors">{paper.authors}</span>
				<span className="research-paper-page-rule" />
				<span className="research-paper-page-text">{paper.abstract}</span>
			</div>
		</article>
	);
}

export function DiscoveryCards() {
	return (
		<CardRow>
			<FeatureCard wash="sky" title="Matched to your interests" text="Every lesson in your feed traces back to a topic you chose, never to what is trending.">
				<AppShot scope="discover-home" className="ls-shot-discover is-bleed is-flush">
					<LessonCard
						image="/media/lessons/python.webp"
						channel="Programming with Mosh"
						length="1 h 40 min"
						title="Python Full Course for Beginners"
						reason="Build on your interest in Python"
					/>
				</AppShot>
			</FeatureCard>
			<FeatureCard wash="lilac" title="Papers, not just videos" text="The same agent finds the research behind a lesson and adds it to your session.">
				<AppShot scope="research-page" className="ls-shot-paper is-bleed is-wide">
					{papers.map((paper) => (
						<PaperRow paper={paper} key={paper.title} />
					))}
				</AppShot>
			</FeatureCard>
			<FeatureCard wash="mint" title="Learns while you watch" text="What you finish, rewatch and ask about shapes the next lesson you see.">
				<AppShot scope="discover-home" className="ls-shot-feed is-bleed">
					<div className="discovery-section-heading">
						<div>
							<h2>Recommended for you</h2>
							<p className="discover-recommendation-context">Shaped by what you've been learning</p>
						</div>
					</div>
					<LessonCard
						image="/media/lessons/cross-validation.webp"
						channel="StatQuest with Josh Starmer"
						length="6 min"
						title="Machine Learning Fundamentals: Cross Validation"
						reason="Related to your recent sessions"
					/>
				</AppShot>
			</FeatureCard>
		</CardRow>
	);
}
