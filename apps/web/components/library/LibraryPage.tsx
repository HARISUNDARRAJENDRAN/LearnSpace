"use client";

import type { StudySessionSummary } from "@learnspace/shared";
import type { NoteBlock } from "@learnspace/shared/notes";
import { ArrowUpRight, Check, Code2, FileText, MessageSquare, Mic, NotebookPen, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { LibraryChatMessage, LibrarySessionContents } from "../../lib/library/sessions";
import type { WatchLaterPlaylist } from "../../lib/library/watch-later";
import { safeNoteUrl, tableRows } from "../study/note-text";
import { Folder, type FolderColor } from "./Folder";
import { WatchLaterCard } from "./WatchLaterCard";

const finishedDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
const chatDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
// Long enough for the papers to fan out before the folder's contents cover it.
const OPEN_DELAY_MS = 320;

const kindOf = (session: StudySessionSummary) => session.isCourse ? "Playlist" : session.activeResource?.type === "paper" ? "Paper" : "Video";
const colorOf = (session: StudySessionSummary): FolderColor => session.isCourse ? "black" : session.activeResource?.type === "paper" ? "white" : "blue";

/** Playlists kept for later, then the learner's finished sessions, one folder each, holding the notes, conversations and code the session kept. */
export function LibraryPage({ sessions, watchLater }: { sessions: StudySessionSummary[]; watchLater: WatchLaterPlaylist[] }) {
  return (
    <main className="library-home">
      <header className="library-intro">
        <div>
          <h2>Everything you&apos;ve studied</h2>
          <p>Playlists you kept for later wait here until you continue them in Sessions. Every finished session keeps its notes, conversations and code.</p>
        </div>
        <dl className="library-stats">
          <div><dt>Watch later</dt><dd>{watchLater.length}</dd></div>
          <div><dt>Finished</dt><dd>{sessions.length}</dd></div>
        </dl>
      </header>

      <section className="library-section" aria-labelledby="library-watch-later">
        <div className="library-section-heading">
          <h2 id="library-watch-later">Watch later{watchLater.length ? <span className="library-count">{watchLater.length}</span> : null}</h2>
          <p>Playlists you added from Discover. Continue one to open it in Sessions.</p>
        </div>
        {watchLater.length > 0
          ? <ul className="watch-later-grid">{watchLater.map((playlist) => <WatchLaterCard key={playlist.collectionId} playlist={playlist} />)}</ul>
          : <div className="library-empty"><p>Nothing saved for later</p><span>Open a playlist in Discover and choose Watch later to keep it here.</span><Link href="/app/discover">Browse Discover<ArrowUpRight aria-hidden="true" /></Link></div>}
      </section>

      <FinishedSessions sessions={sessions} empty={<div className="library-empty"><p>Nothing finished yet</p><span>Watch a video to the end and pass its mastery check, and its whole workspace lands here.</span><Link href="/app/discover">Find a lesson<ArrowUpRight aria-hidden="true" /></Link></div>} />
    </main>
  );
}

/** Finished sessions as folders; opening one shows the notes, conversations and code it kept. Shared by the Learn and Research libraries. */
export function FinishedSessions({ sessions, empty }: { sessions: StudySessionSummary[]; empty: React.ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  useEffect(() => {
    if (!openId) return;
    const timer = window.setTimeout(() => setShownId(openId), OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [openId]);
  const shown = sessions.find((session) => session.id === shownId) ?? null;
  return (
    <section className="library-section" aria-labelledby="library-finished">
      <div className="library-section-heading">
        <h2 id="library-finished">Finished sessions{sessions.length ? <span className="library-count">{sessions.length}</span> : null}</h2>
        <p>Open a folder to look back through a session.</p>
      </div>
      {sessions.length > 0
        ? <ul className="library-folders">{sessions.map((session) => {
          const meta = [kindOf(session), session.isCourse ? plural(session.resourceCount, "lesson") : null, session.endedAt ? finishedDate.format(new Date(session.endedAt)) : null].filter(Boolean).join(" · ");
          return (
            <li key={session.id}>
              <button className="library-folder" type="button" data-open={openId === session.id || undefined} onClick={() => setOpenId(session.id)} aria-haspopup="dialog">
                <Folder id={session.id} color={colorOf(session)} open={openId === session.id} />
                <span className="library-folder-copy"><strong>{session.title}</strong><small>{meta}</small></span>
              </button>
            </li>
          );
        })}</ul>
        : empty}
      {shown ? <SessionFolder session={shown} onClose={() => { setShownId(null); setOpenId(null); }} /> : null}
    </section>
  );
}

type Tab = "notes" | "chats" | "code";

function SessionFolder({ session, onClose }: { session: StudySessionSummary; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [contents, setContents] = useState<LibrarySessionContents | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("notes");
  const [lessonId, setLessonId] = useState<string | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
    const controller = new AbortController();
    fetch(`/api/v1/library/sessions/${session.id}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<LibrarySessionContents>; })
      .then((data) => { setContents(data); setLessonId(data.lessons.find((lesson) => lesson.resourceId === session.activeResource?.id)?.resourceId ?? data.lessons[0]?.resourceId ?? null); })
      .catch((error: unknown) => { if (!controller.signal.aborted) { console.error("[library] folder contents", error); setFailed(true); } });
    return () => controller.abort();
  }, [session.id, session.activeResource?.id]);

  const lesson = contents?.lessons.find((item) => item.resourceId === lessonId) ?? null;
  const chatCount = lesson ? lesson.chats.length + (lesson.voice.length > 0 ? 1 : 0) : 0;
  const tabs: Array<{ id: Tab; label: string; count: number | null }> = [
    { id: "notes", label: "Notes", count: lesson ? lesson.notes.length : null },
    { id: "chats", label: "Conversations", count: lesson ? chatCount : null },
    ...(session.hasCode ? [{ id: "code" as const, label: "Code", count: null }] : []),
  ];

  return (
    // A click on the backdrop closes the folder; Escape already does, natively.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard path is the dialog's own Escape.
    <dialog ref={dialog} className="library-folder-dialog" aria-label={session.title} onClose={onClose} onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <header className="library-folder-head">
        <div>
          <small><Check aria-hidden="true" />{kindOf(session)} · Finished{session.endedAt ? ` ${finishedDate.format(new Date(session.endedAt))}` : ""}</small>
          <h2>{session.title}</h2>
        </div>
        <div className="library-folder-head-actions">
          {session.route ? <Link className="library-button" href={session.route}>Open session<ArrowUpRight aria-hidden="true" /></Link> : null}
          <button className="library-folder-close" type="button" aria-label="Close" onClick={() => dialog.current?.close()}><X aria-hidden="true" /></button>
        </div>
      </header>

      {contents && contents.lessons.length > 1 ? (
        <nav className="library-folder-lessons" aria-label="Lessons">
          {contents.lessons.map((item, index) => <button key={item.resourceId} type="button" aria-pressed={item.resourceId === lessonId} onClick={() => setLessonId(item.resourceId)}><span>{index + 1}</span>{item.title}</button>)}
        </nav>
      ) : null}

      <div className="library-folder-tabs" role="tablist">
        {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.label}{item.count ? <span className="library-count">{item.count}</span> : null}</button>)}
      </div>

      <div className="library-folder-body" role="tabpanel">
        {failed ? <FolderEmpty icon={<FileText />} text="This folder couldn't be opened. Try again in a moment." />
          : !contents ? <p className="library-folder-loading">Opening…</p>
          : tab === "code" ? (contents.code ? <pre className="library-folder-code" data-language={contents.code.language}><code>{contents.code.code}</code></pre> : <FolderEmpty icon={<Code2 />} text="No code was written in this session." />)
          : !lesson ? <FolderEmpty icon={<FileText />} text="This session has nothing saved." />
          : tab === "notes" ? (lesson.notes.length > 0 ? <NotesView blocks={lesson.notes} /> : <FolderEmpty icon={<NotebookPen />} text="No notes for this lesson." />)
          : chatCount > 0 ? <ChatsView voice={lesson.voice} chats={lesson.chats} />
          : <FolderEmpty icon={<MessageSquare />} text="No conversations for this lesson." />}
      </div>
    </dialog>
  );
}

function FolderEmpty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className="library-folder-empty"><span aria-hidden="true">{icon}</span><p>{text}</p></div>;
}

/** The notes read-only, block by block; diagrams stay in the session, where they can be moved. */
function NotesView({ blocks }: { blocks: NoteBlock[] }) {
  return (
    <article className="library-notes">
      {blocks.map((block) => {
        switch (block.type) {
          case "heading": return <h3 key={block.id}>{block.text}</h3>;
          case "subheading": return <h4 key={block.id}>{block.text}</h4>;
          case "bullet": return <p key={block.id} className="is-bullet">{block.text}</p>;
          case "step": return <p key={block.id} className="is-step">{block.text}</p>;
          case "task": return <p key={block.id} className="is-task" data-done={block.done || undefined}><span aria-hidden="true">{block.done ? <Check /> : null}</span>{block.text}</p>;
          case "code": {
            const [language, ...lines] = block.text.split("\n");
            return <pre key={block.id} data-language={language}><code>{lines.join("\n")}</code></pre>;
          }
          case "table": {
            const [head, ...rows] = tableRows(block.text);
            // Cells never reorder, so they are keyed by position.
            /* biome-ignore-start lint/suspicious/noArrayIndexKey: see above. */
            return <div key={block.id} className="library-notes-table"><table><thead><tr>{head?.map((cell, index) => <th key={index}>{cell}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>;
            /* biome-ignore-end lint/suspicious/noArrayIndexKey: see above. */
          }
          case "image": {
            const image = safeNoteUrl(block.text);
            return image ? <figure key={block.id}><img src={image.url} alt={image.caption} loading="lazy" />{image.caption ? <figcaption>{image.caption}</figcaption> : null}</figure> : null;
          }
          case "link": {
            const link = safeNoteUrl(block.text);
            return link ? <p key={block.id}><a href={link.url} target="_blank" rel="noreferrer">{link.caption || link.url}</a></p> : null;
          }
          case "diagram": return <p key={block.id} className="is-diagram">Diagram — open the session to see it.</p>;
          case "paragraph": return <p key={block.id}>{block.text}</p>;
          default: return <p key={block.id} className="is-callout" data-kind={block.type}><small>{block.type === "eli5" ? "In plain words" : block.type}</small>{block.text}</p>;
        }
      })}
    </article>
  );
}

function ChatsView({ voice, chats }: { voice: LibraryChatMessage[]; chats: LibrarySessionContents["lessons"][number]["chats"] }) {
  return (
    <div className="library-chats">
      {voice.length > 0 ? <Conversation icon={<Mic />} title="Talking through the notes" when={voice[0]?.createdAt ?? null} messages={voice} /> : null}
      {chats.map((chat) => <Conversation key={chat.id} icon={<MessageSquare />} title={chat.messages.find((message) => message.role === "you")?.text ?? "Conversation"} when={chat.startedAt} messages={chat.messages} />)}
    </div>
  );
}

function Conversation({ icon, title, when, messages }: { icon: React.ReactNode; title: string; when: string | null; messages: LibraryChatMessage[] }) {
  return (
    <details className="library-chat">
      <summary><span aria-hidden="true">{icon}</span><strong>{title}</strong><small>{plural(messages.length, "message")}{when ? ` · ${chatDate.format(new Date(when))}` : ""}</small></summary>
      <ol>{messages.map((message) => <li key={message.id} data-role={message.role}><small>{message.role === "you" ? "You" : "Luny"}</small><p>{message.text}</p></li>)}</ol>
    </details>
  );
}
