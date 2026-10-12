import Link from "next/link";
import type { LibraryCollectionDetail, LibraryCollectionSummary, ResearchPaperSummary } from "@learnspace/shared";
import { SaveResourceButton, StartCollectionButton, StartStudyButton } from "../study/StudyActions";
import type { LibraryPageData, SavedLibraryResource } from "../../lib/library/service";
import type { ResearchPageData } from "../../lib/research/service";
import { DocumentUploader } from "../library/DocumentUploader";

type SessionSummary = Awaited<ReturnType<typeof import("../../lib/study/service").listStudySessions>>[number];

function dateLabel(value: string | null): string {
  if (!value) return "Not started";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not started" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function typeLabel(type: string): string {
  return type === "video" ? "Video" : type === "paper" || type === "pdf" ? "Paper" : type[0]?.toUpperCase() + type.slice(1) || "Resource";
}

export function SessionsPage({ sessions }: { sessions: SessionSummary[] }) {
  return (
    <main className="product-page sessions-page">
      {sessions.length === 0 ? <div className="product-empty"><p className="product-empty-kicker">A clear desk</p><h2>Your next session is waiting.</h2><p>Start something from Home, Research, or your Library and it will appear here with its place remembered.</p><Link className="product-primary-link" href="/app">Browse Home</Link></div> : <div className="session-list">{sessions.map((session) => <SessionRow key={session.id} session={session} />)}</div>}
    </main>
  );
}

function SessionRow({ session }: { session: SessionSummary }) {
  return (
    <article className="session-row">
      <div className={`session-row-mark session-row-mark-${session.activeResource?.type ?? "empty"}`} aria-hidden="true"><span>{session.activeResource?.type === "video" ? "V" : session.activeResource?.type === "paper" ? "P" : "—"}</span></div>
      <div className="session-row-main"><div className="product-meta"><span>{session.status}</span><span>{session.mode.replaceAll("_", " ")}</span><span>{session.resourceCount} {session.resourceCount === 1 ? "material" : "materials"}</span></div><h2>{session.title}</h2><p>{session.activeResource ? `${typeLabel(session.activeResource.type)} · ${session.activeResource.title}` : "No active material"}</p></div>
      <div className="session-row-progress"><span>{Math.round(session.progressPct)}%</span><div className="progress-track"><span style={{ width: `${Math.min(100, Math.max(0, session.progressPct))}%` }} /></div><small>Last active {dateLabel(session.lastActiveAt)}</small></div>
      {session.route ? <Link className="product-secondary-link" href={session.route}>Continue <span aria-hidden="true">→</span></Link> : null}
    </article>
  );
}

export function LibraryPage({ data }: { data: LibraryPageData }) {
  const playlists = data.collections.filter((collection) => collection.ownership === "user" && collection.kind === "manual");
  const ownedPaths = data.collections.filter((collection) => collection.ownership === "user" && collection.kind === "learning_path");
  const curated = data.collections.filter((collection) => collection.ownership === "learnspace" && collection.source === "learnspace");
  const generated = data.collections.filter((collection) => collection.ownership === "user" && collection.source === "generated");
  const otherPublic = data.collections.filter((collection) => collection.ownership === "other");
  return (
    <main className="product-page library-page">
      <LibraryLane title="Continue a collection" collections={data.continueCollections} />
      <LibraryLane title="Your playlists" collections={playlists} empty="Create a playlist when you have a sequence in mind." />
      {ownedPaths.length > 0 ? <LibraryLane title="Your learning paths" collections={ownedPaths} /> : null}
      <section className="product-lane document-upload-lane"><div className="product-lane-heading"><h2>Upload a document</h2></div><DocumentUploader /></section>
      <SavedLane resources={data.savedResources} />
      <LibraryLane title="LearnSpace collections" collections={curated} empty="Curated collections will appear here as they are published." />
      {generated.length > 0 ? <LibraryLane title="Made for you" collections={generated} /> : null}
      {otherPublic.length > 0 ? <LibraryLane title="Other public collections" collections={otherPublic} /> : null}
    </main>
  );
}

function LibraryLane({ title, collections, empty = "Nothing here yet." }: { title: string; collections: LibraryCollectionSummary[]; empty?: string }) {
  return <section className="product-lane"><div className="product-lane-heading"><h2>{title}</h2></div>{collections.length > 0 ? <div className="collection-grid">{collections.map((collection) => <CollectionCard key={collection.id} collection={collection} />)}</div> : <div className="lane-empty">{empty}</div>}</section>;
}

function CollectionCard({ collection }: { collection: LibraryCollectionSummary }) {
  const progress = collection.progressPct === null ? null : Math.round(collection.progressPct);
  const sourceLabel = collection.source === "generated" ? "Made for you" : collection.source === "learnspace" ? "LearnSpace" : collection.source === "public" ? "Public" : collection.kind === "manual" ? "Your playlist" : collection.kind.replace("_", " ");
  return <article className="collection-card"><div className="collection-card-top"><span className="collection-kind">{sourceLabel}</span><span>{collection.itemCount} {collection.itemCount === 1 ? "item" : "items"}</span></div><h3><Link href={`/app/library/collections/${collection.id}`}>{collection.title}</Link></h3>{collection.description ? <p>{collection.description}</p> : null}{progress !== null ? <div className="collection-progress"><span>{progress}% complete</span><div className="progress-track"><span style={{ width: `${progress}%` }} /></div></div> : <Link className="product-secondary-link" href={`/app/library/collections/${collection.id}`}>View collection <span aria-hidden="true">→</span></Link>}</article>;
}

function SavedLane({ resources: saved }: { resources: SavedLibraryResource[] }) {
  return <section className="product-lane"><div className="product-lane-heading"><h2>Saved resources</h2></div>{saved.length > 0 ? <div className="saved-resource-list">{saved.map((resource) => <SavedResourceRow key={resource.resourceId} resource={resource} />)}</div> : <div className="lane-empty">Save a video or paper from Home and it will live here.</div>}</section>;
}

function SavedResourceRow({ resource }: { resource: SavedLibraryResource }) {
  const canStudy = resource.type === "video" || resource.type === "paper" || resource.type === "pdf";
  return <article className="saved-resource-row"><div><div className="product-meta"><span>{typeLabel(resource.type)}</span><span>{resource.readiness}</span></div><h3>{resource.title}</h3>{resource.description ? <p>{resource.description}</p> : null}</div><div className="saved-resource-action">{canStudy ? <><StartStudyButton resourceId={resource.resourceId} origin="library" label={resource.progressPct > 0 ? "Continue" : resource.type === "video" ? "Start learning" : "Study paper"} /><SaveResourceButton resourceId={resource.resourceId} saved savedLabel="Unsave" /></> : <SaveResourceButton resourceId={resource.resourceId} saved savedLabel="Unsave" />}</div></article>;
}

export function ResearchPage({ data }: { data: ResearchPageData }) {
  return (
    <main className="product-page research-page">
      <form className="research-search" action="/app/research"><label htmlFor="paper-search">Search papers</label><div><input id="paper-search" name="q" defaultValue={data.query} placeholder="Search titles, abstracts, or ideas" /><button type="submit">Search</button></div></form>
      <ResearchLane title={data.query ? `Results for “${data.query}”` : "Recommended for you"} papers={data.recommended} empty="No matching papers in the catalogue yet." />
      <ResearchLane title="Foundational papers" papers={data.foundational} empty="Foundational papers will appear as the catalogue grows." />
      <ResearchLane title="Recent and current" papers={data.recent} empty="No recent papers are available yet." />
      <ResearchLane title="Saved papers" papers={data.saved} empty="Save a paper to keep it close." />
    </main>
  );
}

export function CollectionDetailPage({ collection }: { collection: LibraryCollectionDetail }) {
  const hasProgress = collection.progressPct !== null;
  const sourceLabel = collection.source === "generated" ? "Made for you" : collection.source === "learnspace" ? "LearnSpace" : collection.source === "public" ? "Public" : collection.kind.replace("_", " ");
  return <main className="product-page collection-detail-page"><Link className="back-link" href="/app/library">← Library</Link><div className="collection-detail-intro"><p className="application-eyebrow">{sourceLabel} collection</p><h1>{collection.title}</h1>{collection.description ? <p>{collection.description}</p> : null}<div className="collection-detail-meta"><span>{collection.itemCount} {collection.itemCount === 1 ? "item" : "items"}</span>{hasProgress ? <span>{Math.round(collection.progressPct ?? 0)}% complete</span> : <span>Not started</span>}</div><StartCollectionButton collectionId={collection.id} label={hasProgress ? "Continue collection" : "Start collection"} /></div><div className="collection-detail-sections">{collection.sections.map((section) => <section className="collection-detail-section" key={section.id}><div><p className="application-eyebrow">Section</p><h2>{section.title}</h2>{section.description ? <p>{section.description}</p> : null}</div><ol>{section.items.map((item) => <li className={item.id === collection.currentItemId ? "is-current" : ""} key={item.id}><span className="collection-item-index">{item.position + 1}</span><span><strong>{item.title}</strong><small>{typeLabel(item.type)}{item.note ? ` · ${item.note}` : ""}</small></span><span className="collection-item-progress">{Math.round(item.progressPct)}%</span></li>)}</ol></section>)}</div></main>;
}

function ResearchLane({ title, papers, empty }: { title: string; papers: ResearchPaperSummary[]; empty: string }) {
  return <section className="product-lane research-lane"><div className="product-lane-heading"><h2>{title}</h2></div>{papers.length > 0 ? <div className="research-list">{papers.map((paper) => <ResearchCard key={paper.resourceId} paper={paper} />)}</div> : <div className="lane-empty">{empty}</div>}</section>;
}

function ResearchCard({ paper }: { paper: ResearchPaperSummary }) {
  return <article className="research-card"><div className="research-card-main"><div className="product-meta"><span>Paper</span>{paper.venue ? <span>{paper.venue}</span> : null}{paper.publicationDate ? <span>{paper.publicationDate}</span> : null}</div><h3>{paper.title}</h3><p className="research-authors">{paper.authors.length > 0 ? paper.authors.join(", ") : "Author information not populated"}</p>{paper.abstract ? <p>{paper.abstract}</p> : <p className="muted-copy">Abstract not available in the catalogue.</p>}{paper.conceptNames.length > 0 ? <p className="research-concepts">{paper.conceptNames.slice(0, 4).join(" · ")}</p> : null}</div><div className="research-card-actions"><StartStudyButton resourceId={paper.resourceId} origin="research" label="Study paper" /><SaveResourceButton resourceId={paper.resourceId} saved={paper.saved} /></div></article>;
}
