import type { CodeLanguage, StudyTool } from "@learnspace/shared";
import { Code, ListChecks, type LucideIcon, MessagesSquare, NotebookPen, Workflow } from "lucide-react";

/** The search parameter that opens a study tool beside the lesson, so the sidebar (and a reload) can deep link into one. */
export const TOOL_PARAM = "tool";

/** Each part of a session as the sidebar names it, the `?tool=` slug that opens it and the side panel it shows (none: the canvas alone). */
export const sessionParts = [
  { slug: "canvas", panel: null, label: "Learning Canvas", Icon: Workflow },
  { slug: "notes", panel: "notes", label: "AI Notes", Icon: NotebookPen },
  { slug: "chat", panel: "ai", label: "AI Chat", Icon: MessagesSquare },
  { slug: "code", panel: "code", label: "Code Exercises", Icon: Code },
  { slug: "practice", panel: "check", label: "Practice & Quizzes", Icon: ListChecks },
] as const satisfies ReadonlyArray<{ slug: string; panel: StudyTool | null; label: string; Icon: LucideIcon }>;

export type SessionPartSlug = (typeof sessionParts)[number]["slug"];

/** The panel a `?tool=` value opens: a tool, null for the canvas alone, or undefined when the value names nothing. */
export function panelForSlug(slug: string | null): StudyTool | null | undefined {
  return sessionParts.find((part) => part.slug === slug)?.panel;
}

export function slugForPanel(panel: StudyTool | null): SessionPartSlug {
  return sessionParts.find((part) => part.panel === panel)?.slug ?? "canvas";
}

export type SessionCodeDraft = { language: CodeLanguage; code: string };

export const codeLanguageLabels: Record<CodeLanguage, string> = { python: "Python", javascript: "JavaScript", typescript: "TypeScript", java: "Java", cpp: "C++", go: "Go", rust: "Rust", sql: "SQL" };
