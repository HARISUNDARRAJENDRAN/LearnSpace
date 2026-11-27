import { sessionFolderIdSchema } from "@learnspace/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FolderCanvas } from "@/components/folders/FolderCanvas";

export const metadata: Metadata = { title: "Learning Canvas | LearnSpace" };

export default async function FolderRoute({ params, searchParams }: {
  params: Promise<{ folderId: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const folder = sessionFolderIdSchema.safeParse((await params).folderId);
  const { mode } = await searchParams;
  if (!folder.success) notFound();
  return <FolderCanvas key={folder.data} folderId={folder.data} mode={mode === "research" ? "research" : "learn"} />;
}
