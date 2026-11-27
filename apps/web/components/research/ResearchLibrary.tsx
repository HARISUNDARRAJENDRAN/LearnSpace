import { ArrowUpRight, Play } from "lucide-react";
import Link from "next/link";
import type { ResearchLibraryData, ResearchLibraryPaper } from "../../lib/research/service";
import { studyHomeHref } from "../application/sessions";
import { FinishedSessions } from "../library/LibraryPage";
import { ResearchPaperRow } from "./ResearchPaperRow";

function readingStatus(paper: ResearchLibraryPaper) {
  if (paper.completed) return "Read";
  if (paper.progressPct > 0) return [paper.page ? `Page ${paper.page}` : null, `${Math.round(paper.progressPct)}% read`].filter(Boolean).join(" · ");
  return "Not started";
}

const lastRead = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

/** The Research side of the Library: what the learner is reading, what they saved, and the paper sessions they finished. */
export function ResearchLibrary({ data }: { data: ResearchLibraryData }) {
  const { reading, saved, finished } = data;
  return (
    <main className="library-home research-library">
      <header className="library-intro">
        <div>
          <h2>Your research library</h2>
          <p>Papers you saved and are reading, with your place kept. Every finished paper session keeps its notes and conversations.</p>
        </div>
        <dl className="library-stats">
          <div><dt>Reading</dt><dd>{reading.length}</dd></div>
          <div><dt>Saved</dt><dd>{saved.length}</dd></div>
          <div><dt>Finished</dt><dd>{finished.length}</dd></div>
        </dl>
      </header>

      {reading.length > 0 ? (
        <section className="library-section" aria-labelledby="research-library-reading">
          <div className="library-section-heading">
            <h2 id="research-library-reading">Continue reading<span className="library-count">{reading.length}</span></h2>
            <p>Pick up on the page you left.</p>
          </div>
          <ul className="watch-later-grid">
            {reading.map((session) => (
              <li key={session.id} className="watch-later-card">
                <span className="watch-later-media research-library-media" aria-hidden="true">
                  <span className="research-paper-page"><span className="research-paper-page-meta">Paper</span><span className="research-paper-page-title">{session.title}</span><span className="research-paper-page-rule" /></span>
                  <span className="library-media-badge">{Math.round(session.progressPct)}% read</span>
                  <span className="research-library-progress"><span style={{ width: `${Math.min(100, Math.max(0, session.progressPct))}%` }} /></span>
                </span>
                <span className="watch-later-copy">
                  <strong>{session.title}</strong>
                  <small>Paper · Last read {lastRead.format(new Date(session.lastActiveAt))}</small>
                </span>
                <Link className="watch-later-continue" href={session.route ?? studyHomeHref("research")}><Play aria-hidden="true" />Continue studying</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="library-section" aria-labelledby="research-library-saved">
        <div className="library-section-heading">
          <h2 id="research-library-saved">Saved papers{saved.length ? <span className="library-count">{saved.length}</span> : null}</h2>
          <p>Newest first. Open one to study it with Luny.</p>
        </div>
        {saved.length > 0
          ? <div className="research-feed"><div className="research-feed-grid">{saved.map((paper) => <ResearchPaperRow key={paper.resourceId} paper={paper} status={readingStatus(paper)} />)}</div></div>
          : <div className="library-empty"><p>No saved papers yet</p><span>Bookmark a paper on Research Home and it stays here with your reading position.</span><Link href="/app/research">Browse papers<ArrowUpRight aria-hidden="true" /></Link></div>}
      </section>

      <FinishedSessions sessions={finished} empty={<div className="library-empty"><p>No finished papers yet</p><span>Finish a paper session and its notes and conversations land here.</span><Link href="/app/research">Find a paper<ArrowUpRight aria-hidden="true" /></Link></div>} />
    </main>
  );
}
