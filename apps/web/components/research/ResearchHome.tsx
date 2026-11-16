import { Plus } from "lucide-react";
import Link from "next/link";
import type { ResearchAuthorSummary } from "@learnspace/shared";
import type { ResearchPageData } from "../../lib/research/service";
import { AuthorAvatar, ResearchAuthorList } from "./ResearchAuthor";
import { ResearchCarousel } from "./ResearchCarousel";
import { ResearchPaperMini, ResearchPaperRow } from "./ResearchPaperRow";
import { type RefineData, RefineRecommendations } from "./RefineRecommendations";

function feedHref(tab: string, topicId: string | null) {
  const params = new URLSearchParams();
  if (tab !== "for-you") params.set("tab", tab);
  if (topicId) params.set("topic", topicId);
  const search = params.toString();
  return `/app/research${search ? `?${search}` : ""}`;
}

function FavoriteAuthor({ author }: { author: ResearchAuthorSummary }) {
  const label = `${author.name}${author.unreadCount ? `, ${author.unreadCount} unread ${author.unreadCount === 1 ? "paper" : "papers"}` : ""}${author.source === "engaged" ? " (from your reading)" : ""}`;
  return <Link className="research-favorite-author" href={`/app/research/authors/${author.authorId}`} title={label} aria-label={label}>
    <span className="research-favorite-portrait"><AuthorAvatar name={author.name} />{author.unreadCount ? <span className="research-unread">{author.unreadCount > 99 ? "99+" : author.unreadCount}</span> : null}</span>
    <span className="research-favorite-name">{author.name}</span>
  </Link>;
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <Link className={`research-tab${active ? " is-active" : ""}`} href={href} aria-current={active ? "page" : undefined}>{children}</Link>;
}

export function ResearchHome({ data }: { data: ResearchPageData }) {
  const favorites = data.favoriteAuthors;
  const refine: RefineData = { topics: data.topics, followed: favorites.filter(({ source }) => source === "followed"), suggested: data.suggestedAuthors };
  const following = data.tab === "following" && !data.topicId;
  const emptyFeed = following
    ? { title: "Nobody followed yet", body: "Follow authors from the suggestions and their papers collect here." }
    : { title: "No papers here yet", body: "Try another topic, or search for a paper from the bar above." };
  return <main className="research-page">
    <h1 className="research-visually-hidden">Research</h1>
    <section className="research-top-row" aria-label="Your reading">
      <section className="research-top-card" aria-labelledby="research-saved-heading">
        <div className="research-top-heading"><h2 id="research-saved-heading">Recently saved</h2><Link href="/app/library?view=papers">See the full list</Link></div>
        {data.saved.length
          ? <ul className="research-recent-saved">{data.saved.slice(0, 3).map((paper) => <ResearchPaperMini paper={paper} key={paper.resourceId} />)}</ul>
          : <p className="research-recent-saved is-empty">Bookmark a paper and it shows up here.</p>}
      </section>
      <section className="research-top-card research-favorites-card" aria-labelledby="research-favorites-heading">
        <div className="research-top-heading"><h2 id="research-favorites-heading">Favorite authors</h2><RefineRecommendations data={refine} view="authors" className="research-add" label="Follow authors"><Plus aria-hidden="true" /></RefineRecommendations></div>
        {favorites.length
          ? <ResearchCarousel label="favorite authors" className="research-author-carousel">{favorites.map((author) => <FavoriteAuthor author={author} key={author.authorId} />)}</ResearchCarousel>
          : <p className="research-empty-inline">Follow authors, or read and save a few papers. The people you keep coming back to appear here.</p>}
      </section>
    </section>

    <nav className="research-navigation-row" aria-label="Paper feeds">
      <ResearchCarousel label="paper feeds" className="research-topic-carousel">
        <Tab href={feedHref("following", null)} active={following}>Following</Tab>
        <Tab href={feedHref("for-you", null)} active={data.tab === "for-you" && !data.topicId}>For you</Tab>
        <Tab href={feedHref("foundational", null)} active={data.tab === "foundational" && !data.topicId}>Foundational</Tab>
        {data.topics.map((topic) => <Tab key={topic.id} href={feedHref("for-you", topic.id)} active={data.topicId === topic.id}>{topic.name}</Tab>)}
      </ResearchCarousel>
      <RefineRecommendations data={refine} view="topics" className="research-add" label="Add topics"><Plus aria-hidden="true" /></RefineRecommendations>
      <RefineRecommendations data={refine} view="topics" className="research-refine-pill" label="Refine recommendations">Refine recommendations</RefineRecommendations>
    </nav>

    <div className="research-content-grid">
      <section className="research-feed" aria-label="Papers">
        {data.recommended.length
          ? <div className="research-feed-grid">{data.recommended.map((paper) => <ResearchPaperRow paper={paper} key={paper.resourceId} />)}</div>
          : <div className="research-empty-panel"><h3>{emptyFeed.title}</h3><p>{emptyFeed.body}</p></div>}
      </section>
      <aside className="research-rail" aria-label="Suggestions">
        <section className="research-rail-section" aria-labelledby="research-foundational-heading">
          <h2 id="research-foundational-heading">Foundational picks</h2>
          {data.foundational.length
            ? <><ul className="research-rail-papers">{data.foundational.slice(0, 3).map((paper) => <ResearchPaperMini paper={paper} key={paper.resourceId} />)}</ul>{data.foundational.length > 3 ? <Link className="research-rail-more" href={feedHref("foundational", null)}>See the full list</Link> : null}</>
            : <p className="research-empty-inline">Seminal papers for your topics will appear here.</p>}
        </section>
        <section className="research-rail-section" aria-labelledby="research-follow-heading">
          <h2 id="research-follow-heading">Authors to follow</h2>
          <ResearchAuthorList authors={data.suggestedAuthors.slice(0, 3)} empty="Suggestions appear once papers in your topics are catalogued." />
          {data.suggestedAuthors.length > 3 ? <RefineRecommendations data={refine} view="authors" className="research-rail-more" label="See more suggestions">See more suggestions</RefineRecommendations> : null}
        </section>
      </aside>
    </div>
  </main>;
}
