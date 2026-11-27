"use client";

import { sessionFolderIdSchema } from "@learnspace/shared";
import { FolderClosed } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { MoveSessionDialog } from "./FolderDialogs";
import { folderHref } from "./state";

let folderQuestion: { path: string; text: string } | null = null;

export function leaveFolderQuestion(path: string, text: string) {
  folderQuestion = { path, text };
}

export function takeFolderQuestion(path: string) {
  if (folderQuestion?.path !== path) return null;
  const { text } = folderQuestion;
  folderQuestion = null;
  return text;
}

export function useFolderReturn() {
  const params = useSearchParams();
  const folder = sessionFolderIdSchema.safeParse(params.get("folder"));
  return folder.success ? folderHref(folder.data, params.get("folderMode") === "research" ? "research" : "learn") : null;
}

export function StudyFolderBreadcrumb({ children }: { children: ReactNode }) {
  const href = useFolderReturn();
  return href ? <Link href={href} aria-label="Back to folder" title="Back to folder"><FolderClosed aria-hidden="true" /></Link> : children;
}

export function StudyFolderAction({ session }: { session: { id: string; title: string } }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="session-icon-button" aria-label="Move session to folder" title="Move session to folder" onClick={() => setOpen(true)}><FolderClosed aria-hidden="true" /></button>
    {open ? <MoveSessionDialog session={session} onClose={() => setOpen(false)} /> : null}
  </>;
}
