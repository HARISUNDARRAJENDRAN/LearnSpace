import { Ellipsis } from "lucide-react";
import type { ResearchPaper } from "@learnspace/shared";
import { StartStudyButton, SaveResourceButton } from "../study/StudyActions";
import { AuthorAvatar, ResearchAuthorLink } from "./ResearchAuthor";

// shortcut: reading time is estimated from a typical paper length until parsed page counts are stored.
function estimateReadTime(paper: ResearchPaper) {
  const abstractWords = paper.abstract?.trim().split(/\s+/).length ?? 0;
  return `${Math.max(4, Math.ceil((abstractWords + 1800) / 240))} min read`;
}

export function paperSourceUrl(paper: Pick<ResearchPaper, "pdfSourceUrl" | "arxivId" | "doi">): string | null {
  if (paper.arxivId) return `https://arxiv.org/abs/${paper.arxivId}`;
  if (paper.doi) return `https://doi.org/${paper.doi}`;
  return paper.pdfSourceUrl;
}

function formatDate(date: string | null) {
  return date ? new Date(`${date}T00:00:00`).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : null;
}

// A typeset first-page miniature built from the paper's own metadata (no stock imagery).
function PaperPage({ paper }: { paper: ResearchPaper }) {
  const year = paper.publicationDate?.slice(0, 4);
  return <div className="research-paper-page" aria-hidden="true">
    <span className="research-paper-page-meta">{[paper.venue, year].filter(Boolean).join(" · ") || "Paper"}</span>
    <span className="research-paper-page-title">{paper.title}</span>
    {paper.authors.length ? <span className="research-paper-page-authors">{paper.authors.slice(0, 3).join(", ")}</span> : null}
    <span className="research-paper-page-rule" />
    <span className="research-paper-page-text">{paper.abstract}</span>
  </div>;
}

/** `status` replaces the read-time estimate, e.g. the learner's reading position in the Library. */
export function ResearchPaperRow({ paper, status }: { paper: ResearchPaper; status?: string | undefined }) {
  const authorId = paper.authorIds[0];
  const authorName = paper.authors[0];
  const date = formatDate(paper.publicationDate);
  const source = paperSourceUrl(paper);
  return <article className="research-paper-row">
    <div className="research-paper-copy">
      <div className="research-paper-byline">
        {authorId && authorName ? <ResearchAuthorLink authorId={authorId} name={authorName} avatarClass="is-small" /> : null}
        {paper.authors.length > 1 ? <span>+{paper.authors.length - 1}</span> : null}
        {date ? <time dateTime={paper.publicationDate ?? undefined}>{date}</time> : null}
        {paper.venue ? <span className="research-paper-venue">{paper.venue}</span> : null}
      </div>
      <StartStudyButton className="research-paper-title" resourceId={paper.resourceId} origin="research" label={paper.title} />
      {paper.abstract ? <p className="research-paper-excerpt">{paper.abstract}</p> : <p className="research-paper-excerpt is-missing">Abstract not available yet.</p>}
      <div className="research-paper-footer">
        {paper.conceptNames[0] ? <span className="research-concept-chip">{paper.conceptNames[0]}</span> : null}
        <span>{status ?? estimateReadTime(paper)}</span>
        <span className="research-paper-actions">
          <SaveResourceButton resourceId={paper.resourceId} saved={paper.saved} className="research-icon-button" variant="icon" />
          <details className="research-overflow">
            <summary className="research-icon-button" aria-label={`More actions for ${paper.title}`}><Ellipsis aria-hidden="true" /></summary>
            <div className="research-overflow-menu">
              {source ? <a href={source} target="_blank" rel="noreferrer">Open original source</a> : null}
              {authorId && authorName ? <a href={`/app/research/authors/${authorId}`}>More from {authorName}</a> : null}
              <StartStudyButton resourceId={paper.resourceId} origin="research" label="Study this paper" />
            </div>
          </details>
        </span>
      </div>
    </div>
    <PaperPage paper={paper} />
  </article>;
}

export function ResearchPaperMini({ paper }: { paper: ResearchPaper }) {
  const authorId = paper.authorIds[0];
  const authorName = paper.authors[0];
  return <li className="research-mini-paper">
    {authorId && authorName ? <ResearchAuthorLink authorId={authorId} name={authorName} avatarClass="is-tiny" /> : <span className="research-author-link"><AuthorAvatar name={paper.venue ?? paper.title} className="is-tiny" /><span>{paper.venue ?? "Paper"}</span></span>}
    <StartStudyButton className="research-mini-title" resourceId={paper.resourceId} origin="research" label={paper.title} />
  </li>;
}
