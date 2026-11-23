import { sessionFolderDetailsQuerySchema, sessionFolderIdSchema } from "@learnspace/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FolderDashboard } from "@/components/folders/FolderDashboard";

export const metadata: Metadata = { title: "Session folder | LearnSpace" };

export default async function FolderRoute({ params, searchParams }: {
  params: Promise<{ folderId: string }>;
  searchParams: Promise<{ mode?: string; section?: string; page?: string }>;
}) {
  const folder = sessionFolderIdSchema.safeParse((await params).folderId);
  const { mode, section, page } = await searchParams;
  const query = sessionFolderDetailsQuerySchema.safeParse({ section, page });
  if (!folder.success || !query.success) notFound();
  return <FolderDashboard key={folder.data} folderId={folder.data} mode={mode === "research" ? "research" : "learn"} query={query.data} />;
}
