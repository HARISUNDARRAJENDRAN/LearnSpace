import type { Transaction } from "@learnspace/db";
import { type PaperCitationAnchor } from "@learnspace/shared";
import { sql } from "drizzle-orm";
import { lexicalQuery, questionTerms } from "../tutor/scope";
import { type FolderMaterial } from "./details";

export type FolderPassage = {
  id: string;
  versionId: string;
  resourceId: string;
  title: string;
  content: string;
  ordinal: number;
  startMs: number | null;
  endMs: number | null;
  page: number | null;
  section: string | null;
};

export async function folderPassages(tx: Transaction, materials: FolderMaterial[], question?: string): Promise<FolderPassage[]> {
  const versions = materials.flatMap((item) => item.versionId ? [item.versionId] : []);
  if (!versions.length) return [];
  const terms = question ? lexicalQuery(questionTerms(question)) : "";
  // Take the best matching passages across the folder, reserving room for distinct sources on broad questions.
  return Array.from(await tx.execute<FolderPassage>(sql`
    WITH ranked AS (
      SELECT c.id, c.resource_version_id AS "versionId", r.id AS "resourceId", r.title,
        left(c.content, 2400) AS content, c.ordinal, c.start_ms AS "startMs", c.end_ms AS "endMs",
        c.page_from AS page, c.heading_path[array_length(c.heading_path, 1)] AS section,
        ts_rank_cd(c.search_tsv, to_tsquery('simple', ${terms || "learnspaceunmatched"})) AS relevance,
        row_number() OVER (PARTITION BY c.resource_version_id ORDER BY c.ordinal) AS passage,
        count(*) OVER (PARTITION BY c.resource_version_id) AS total
      FROM retrieval.resource_chunks c
      JOIN catalog.resources r ON r.current_version_id = c.resource_version_id
      WHERE c.resource_version_id IN (${sql.join(versions.map((id) => sql`${id}`), sql`, `)})
    ), diversified AS (
      SELECT *, row_number() OVER (PARTITION BY "versionId" ORDER BY relevance DESC,
        CASE WHEN (passage - 1) % greatest(1, total / 8) = 0 OR total < 16 THEN 0 ELSE 1 END, ordinal) AS rank
      FROM ranked
    )
    SELECT id, "versionId", "resourceId", title, content, ordinal, "startMs", "endMs", page, section
    FROM diversified ORDER BY rank, relevance DESC, "resourceId" LIMIT ${question ? 24 : 64}
  `));
}

export function passageAnchor(passage: FolderPassage): PaperCitationAnchor | undefined {
  return passage.page === null ? undefined : { kind: "paper", page: passage.page, sectionId: passage.section?.slice(0, 200) || "unsectioned", chunkId: passage.id };
}
