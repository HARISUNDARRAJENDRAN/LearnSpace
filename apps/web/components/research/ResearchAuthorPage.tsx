import Link from "next/link";
import type { ResearchPaper } from "@learnspace/shared";
import { FollowAuthorButton } from "./ResearchAuthorControls";
import { AuthorAvatar } from "./ResearchAuthor";
import { ResearchPaperRow } from "./ResearchPaperRow";

export function ResearchAuthorPage({ author, papers }: { author: { authorId: string; name: string; followed: boolean }; papers: ResearchPaper[] }) {
  return <main className="research-page research-author-page">
    <Link className="research-back-link" href="/app/research">← Research</Link>
    <header className="research-author-header"><AuthorAvatar name={author.name} className="is-large" /><div><p className="research-kicker">Catalog author</p><h1>{author.name}</h1><p>{papers.length} {papers.length === 1 ? "paper" : "papers"} in the LearnSpace catalog</p></div><FollowAuthorButton authorId={author.authorId} followed={author.followed} /></header>
    <section className="research-feed" aria-labelledby="research-author-papers"><div className="research-section-heading"><div><h2 id="research-author-papers">Papers by {author.name}</h2><p>Open a paper to start or resume a study session.</p></div></div>
      {papers.length ? <div className="research-feed-grid">{papers.map((paper) => <ResearchPaperRow paper={paper} key={paper.resourceId} />)}</div> : <div className="research-empty-panel"><h3>No catalog papers yet</h3><p>Only papers linked to this canonical author record appear here.</p></div>}
    </section>
  </main>;
}
