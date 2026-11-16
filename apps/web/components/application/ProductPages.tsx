import Link from "next/link";
import type { LibraryCollectionDetail } from "@learnspace/shared";
import { RewatchLesson } from "../library/RewatchLesson";
import { StartCollectionButton } from "../study/StudyActions";

function typeLabel(type: string): string {
  return type === "video" ? "Video" : type === "paper" || type === "pdf" ? "Paper" : type[0]?.toUpperCase() + type.slice(1) || "Resource";
}

export function CollectionDetailPage({ collection }: { collection: LibraryCollectionDetail }) {
  const hasProgress = collection.status === "active" || collection.status === "completed";
  const sourceLabel = collection.source === "generated" ? "Made for you" : collection.source === "learnspace" ? "LearnSpace" : collection.source === "public" ? "Public" : collection.kind.replace("_", " ");
  return <main className="product-page collection-detail-page"><Link className="back-link" href="/app/library">← Library</Link><div className="collection-detail-intro"><p className="application-eyebrow">{sourceLabel} collection</p><h1>{collection.title}</h1>{collection.description ? <p>{collection.description}</p> : null}<div className="collection-detail-meta"><span>{collection.itemCount} {collection.itemCount === 1 ? "item" : "items"}</span>{hasProgress ? <span>{Math.round(collection.progressPct ?? 0)}% complete</span> : <span>Not started</span>}</div>{collection.status === "completed" ? <p className="collection-detail-finished">Finished. Rewatch any lesson below; it won&apos;t change your progress.</p> : <StartCollectionButton endpoint={`/api/v1/library/collections/${collection.id}/start`} label={hasProgress ? "Continue collection" : "Start collection"} />}</div><div className="collection-detail-sections">{collection.sections.map((section) => <section className="collection-detail-section" key={section.id}><div><p className="application-eyebrow">Section</p><h2>{section.title}</h2>{section.description ? <p>{section.description}</p> : null}</div><ol>{section.items.map((item) => <li className={item.id === collection.currentItemId ? "is-current" : ""} key={item.id}><span className="collection-item-index">{item.position + 1}</span><span><strong>{item.title}</strong><small>{typeLabel(item.type)}{item.note ? ` · ${item.note}` : ""}</small></span>{item.completed && item.youtubeId ? <RewatchLesson youtubeId={item.youtubeId} title={item.title} /> : <span className="collection-item-progress">{Math.round(item.progressPct)}%</span>}</li>)}</ol></section>)}</div></main>;
}

