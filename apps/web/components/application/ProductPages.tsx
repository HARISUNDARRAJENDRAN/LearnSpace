import Link from "next/link";
import type { LibraryCollectionDetail, LibraryCollectionSummary, ResearchPaperSummary } from "@learnspace/shared";
import { RewatchLesson } from "../library/RewatchLesson";
import { SaveResourceButton, StartCollectionButton, StartStudyButton } from "../study/StudyActions";
import type { LibraryPageData, SavedLibraryResource } from "../../lib/library/service";
import type { ResearchPageData } from "../../lib/research/service";

function typeLabel(type: string): string {
  return type === "video" ? "Video" : type === "paper" || type === "pdf" ? "Paper" : type[0]?.toUpperCase() + type.slice(1) || "Resource";
}

export function LibraryPage({ data }: { data: LibraryPageData }) {
  const enrolled = (status: LibraryCollectionSummary["status"]) => data.collections.filter((collection) => collection.status === status);
  const owned = (kind: LibraryCollectionSummary["kind"]) => data.collections.filter((collection) => collection.ownership === "user" && collection.kind === kind);
  const [active, finished, ownedPaths, generated] = [enrolled("active"), enrolled("completed"), owned("learning_path"), data.collections.filter((collection) => collection.source === "generated")];
  return (
    <main className="product-page library-page">
      {active.length > 0 ? <LibraryLane title="Continue" collections={active} /> : null}
      <LibraryLane title="Up next" collections={enrolled("queued")} empty="Add a course from Discover and it joins this queue. Each one starts when the course before it finishes." />
      <LibraryLane title="Your playlists" collections={owned("manual")} empty="Create a playlist when you have a sequence in mind." />
      {ownedPaths.length > 0 ? <LibraryLane title="Your learning paths" collections={ownedPaths} /> : null}
      <SavedLane resources={data.savedResources} />
      {generated.length > 0 ? <LibraryLane title="Made for you" collections={generated} /> : null}
      {finished.length > 0 ? <LibraryLane title="Finished" collections={finished} /> : null}
    </main>
  );
}

function LibraryLane({ title, collections, empty = "Nothing here yet." }: { title: string; collections: LibraryCollectionSummary[]; empty?: string }) {
  return <section className="product-lane"><div className="product-lane-heading"><h2>{title}</h2></div>{collections.length > 0 ? <div className="collection-grid">{collections.map((collection) => <CollectionCard key={collection.id} collection={collection} />)}</div> : <div className="lane-empty">{empty}</div>}</section>;
}

function CollectionCard({ collection }: { collection: LibraryCollectionSummary }) {
  const progress = collection.status === "active" || collection.status === "completed" ? Math.round(collection.progressPct ?? 0) : null;
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
  const hasProgress = collection.status === "active" || collection.status === "completed";
  const sourceLabel = collection.source === "generated" ? "Made for you" : collection.source === "learnspace" ? "LearnSpace" : collection.source === "public" ? "Public" : collection.kind.replace("_", " ");
  return <main className="product-page collection-detail-page"><Link className="back-link" href="/app/library">← Library</Link><div className="collection-detail-intro"><p className="application-eyebrow">{sourceLabel} collection</p><h1>{collection.title}</h1>{collection.description ? <p>{collection.description}</p> : null}<div className="collection-detail-meta"><span>{collection.itemCount} {collection.itemCount === 1 ? "item" : "items"}</span>{hasProgress ? <span>{Math.round(collection.progressPct ?? 0)}% complete</span> : <span>Not started</span>}</div>{collection.status === "completed" ? <p className="collection-detail-finished">Finished. Rewatch any lesson below; it won&apos;t change your progress.</p> : <StartCollectionButton collectionId={collection.id} label={hasProgress ? "Continue collection" : "Start collection"} />}</div><div className="collection-detail-sections">{collection.sections.map((section) => <section className="collection-detail-section" key={section.id}><div><p className="application-eyebrow">Section</p><h2>{section.title}</h2>{section.description ? <p>{section.description}</p> : null}</div><ol>{section.items.map((item) => <li className={item.id === collection.currentItemId ? "is-current" : ""} key={item.id}><span className="collection-item-index">{item.position + 1}</span><span><strong>{item.title}</strong><small>{typeLabel(item.type)}{item.note ? ` · ${item.note}` : ""}</small></span>{item.completed && item.youtubeId ? <RewatchLesson youtubeId={item.youtubeId} title={item.title} /> : <span className="collection-item-progress">{Math.round(item.progressPct)}%</span>}</li>)}</ol></section>)}</div></main>;
}

function ResearchLane({ title, papers, empty }: { title: string; papers: ResearchPaperSummary[]; empty: string }) {
  return <section className="product-lane research-lane"><div className="product-lane-heading"><h2>{title}</h2></div>{papers.length > 0 ? <div className="research-list">{papers.map((paper) => <ResearchCard key={paper.resourceId} paper={paper} />)}</div> : <div className="lane-empty">{empty}</div>}</section>;
}

function ResearchCard({ paper }: { paper: ResearchPaperSummary }) {
  return <article className="research-card"><div className="research-card-main"><div className="product-meta"><span>Paper</span>{paper.venue ? <span>{paper.venue}</span> : null}{paper.publicationDate ? <span>{paper.publicationDate}</span> : null}</div><h3>{paper.title}</h3><p className="research-authors">{paper.authors.length > 0 ? paper.authors.join(", ") : "Author information not populated"}</p>{paper.abstract ? <p>{paper.abstract}</p> : <p className="muted-copy">Abstract not available in the catalogue.</p>}{paper.conceptNames.length > 0 ? <p className="research-concepts">{paper.conceptNames.slice(0, 4).join(" · ")}</p> : null}</div><div className="research-card-actions"><StartStudyButton resourceId={paper.resourceId} origin="research" label="Study paper" /><SaveResourceButton resourceId={paper.resourceId} saved={paper.saved} /></div></article>;
}
