import Link from "next/link";
import type { ResearchAuthorSummary } from "@learnspace/shared";
import { FollowAuthorButton } from "./ResearchAuthorControls";

export function AuthorAvatar({ name, className = "" }: { name: string; className?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase() || "?";
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return <span className={`research-avatar research-avatar-${Math.abs(hash) % 5}${className ? ` ${className}` : ""}`} aria-hidden="true">{initials}</span>;
}

export function ResearchAuthorLink({ authorId, name, avatarClass = "" }: { authorId: string; name: string; avatarClass?: string }) {
  return <Link className="research-author-link" href={`/app/research/authors/${authorId}`}><AuthorAvatar name={name} className={avatarClass} /><span>{name}</span></Link>;
}

export function ResearchAuthorList({ authors: people, empty }: { authors: ResearchAuthorSummary[]; empty: string }) {
  if (!people.length) return <p className="research-empty-inline">{empty}</p>;
  return <div className="research-author-list">
    {people.map((author) => <article className="research-author-person" key={author.authorId}>
      <ResearchAuthorLink authorId={author.authorId} name={author.name} />
      <FollowAuthorButton authorId={author.authorId} followed={author.followed} compact />
    </article>)}
  </div>;
}
