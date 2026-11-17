/**
 * Syncs the Research catalogue with the curriculum: pnpm --filter @learnspace/worker research:catalog:backfill
 * Uses DATABASE_WORKER_URL and batches arXiv requests at its 3-second limit. Run it after each curriculum change, locally
 * and against production; it upserts public papers and the Discover tracks and touches no learner data.
 */
import postgres from "postgres";
import { researchCurriculumSchema } from "@learnspace/shared";
import curriculumData from "../../../apps/web/lib/research/curriculum/data.json" with { type: "json" };
import { fetchCatalogPapers, normalizeArxivId, upsertCatalogPaper } from "./paper-catalog.js";
import { curriculumPaperMetadata, curriculumTrackSections } from "./paper-catalog-materialization.js";

const databaseUrl = process.env.DATABASE_WORKER_URL;
if (!databaseUrl) throw new Error("DATABASE_WORKER_URL is required");

const curriculum = researchCurriculumSchema.parse(curriculumData);
const curriculumIds = curriculum.items.flatMap((item) => item.type === "paper" ? [item.arxivId] : []);
const associations = curriculumPaperMetadata(curriculum);
type ResourceRow = { id: string; arxiv_id: string; owner_user_id: string | null };
type CountRow = { resources: number; with_authors: number; clean_abstracts: number; with_pdf: number };
type QuerySql = ReturnType<typeof postgres> | postgres.TransactionSql;

function jsonSame(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

async function counts(tx: QuerySql): Promise<CountRow> {
  const [row] = await tx<CountRow[]>`
    SELECT
      count(DISTINCT r.id)::int AS resources,
      count(DISTINCT r.id) FILTER (WHERE EXISTS (SELECT 1 FROM catalog.paper_authors pa WHERE pa.paper_resource_id = r.id))::int AS with_authors,
      count(DISTINCT r.id) FILTER (WHERE nullif(trim(pd.abstract), '') IS NOT NULL AND pd.abstract !~ '(^|\\n)\\s*(#|arXiv:|Submitted on)' )::int AS clean_abstracts,
      count(DISTINCT r.id) FILTER (WHERE nullif(trim(pd.pdf_source_url), '') IS NOT NULL)::int AS with_pdf
    FROM catalog.resources r LEFT JOIN catalog.paper_details pd ON pd.resource_id = r.id
    WHERE r.type = 'paper' AND r.provider = 'arxiv' AND r.deleted_at IS NULL
      AND r.external_id ~ '^([[:alpha:]][[:alnum:].-]{1,31}/[0-9]{7}|[0-9]{4}[.][0-9]{4,5})(v[0-9]+)?$'
  `;
  return row ?? { resources: 0, with_authors: 0, clean_abstracts: 0, with_pdf: 0 };
}

async function upsertTrack(sql: postgres.TransactionSql, track: typeof curriculum.tracks[number], resourceByArxivId: Map<string, string>): Promise<number> {
  const slug = `research-track-${track.id}`;
  const description = `${track.audience} Outcomes: ${track.outcomes.join("; ")}`;
  const metadata = { curriculumVersion: curriculum.version, trackId: track.id };
  const [existing] = await sql<{ id: string }[]>`SELECT id::text AS id FROM catalog.collections WHERE slug = ${slug} LIMIT 1`;
  let collectionId = existing?.id;
  let created = 0;
  if (!collectionId) {
    const [inserted] = await sql<{ id: string }[]>`
      INSERT INTO catalog.collections (owner_user_id, kind, slug, visibility, title, description, published_at, metadata)
      VALUES (NULL, 'learning_path', ${slug}, 'public', ${track.title}, ${description}, now(), ${sql.json(metadata)})
      ON CONFLICT (slug) WHERE slug IS NOT NULL DO NOTHING RETURNING id::text AS id
    `;
    collectionId = inserted?.id;
    created = inserted ? 1 : 0;
    if (!collectionId) {
      const [raced] = await sql<{ id: string }[]>`SELECT id::text AS id FROM catalog.collections WHERE slug = ${slug} LIMIT 1`;
      collectionId = raced?.id;
    }
  }
  if (!collectionId) throw new Error(`Could not create curriculum collection ${slug}`);
  await sql`
    UPDATE catalog.collections SET kind = 'learning_path', owner_user_id = NULL, visibility = 'public', title = ${track.title},
      description = ${description}, published_at = COALESCE(published_at, now()), metadata = metadata || ${sql.json(metadata)},
      updated_at = CASE WHEN kind IS DISTINCT FROM 'learning_path' OR visibility IS DISTINCT FROM 'public' OR title IS DISTINCT FROM ${track.title}
        OR description IS DISTINCT FROM ${description} OR metadata->>'trackId' IS DISTINCT FROM ${track.id} THEN now() ELSE updated_at END
    WHERE id = ${collectionId} AND (kind IS DISTINCT FROM 'learning_path' OR owner_user_id IS NOT NULL OR visibility IS DISTINCT FROM 'public'
      OR title IS DISTINCT FROM ${track.title} OR description IS DISTINCT FROM ${description} OR metadata->>'trackId' IS DISTINCT FROM ${track.id})
  `;
  const sections = curriculumTrackSections(track, curriculum.items);
  for (const section of sections) {
    const [row] = await sql<{ id: string; title: string; description: string | null; metadata: Record<string, unknown> }[]>`
      SELECT id::text AS id, title, description, metadata FROM catalog.collection_sections WHERE collection_id = ${collectionId} AND position = ${section.position} LIMIT 1
    `;
    const sectionMetadata = section.metadata;
    let sectionId = row?.id;
    if (!sectionId) {
      const [inserted] = await sql<{ id: string }[]>`
        INSERT INTO catalog.collection_sections (collection_id, title, description, metadata, position)
        VALUES (${collectionId}, ${section.title}, NULL, ${sql.json(sectionMetadata)}, ${section.position}) RETURNING id::text AS id
      `;
      sectionId = inserted?.id;
    } else if (row && (row.title !== section.title || row.description !== null || !jsonSame(row.metadata, sectionMetadata))) {
      await sql`UPDATE catalog.collection_sections SET title = ${section.title}, description = NULL, metadata = ${sql.json(sectionMetadata)} WHERE id = ${sectionId}`;
    }
    if (!sectionId) throw new Error(`Could not create curriculum module ${section.title}`);
    const items = section.papers.flatMap((paper) => {
      const resourceId = resourceByArxivId.get(paper.arxivId);
      const curriculumItem = curriculum.items.find((item) => item.id === paper.itemId);
      return resourceId && curriculumItem?.type === "paper" ? [{ resourceId, position: paper.position, required: curriculumItem.required, itemId: paper.itemId }] : [];
    });
    const current = await sql<{ resource_id: string; position: number; required: boolean; metadata: Record<string, unknown> }[]>`
      SELECT resource_id::text AS resource_id, position, required, metadata FROM catalog.collection_items WHERE section_id = ${sectionId} ORDER BY position
    `;
    const matches = current.length === items.length && current.every((item, index) => {
      const wanted = items[index];
      return wanted && item.resource_id === wanted.resourceId && item.position === wanted.position && item.required === wanted.required && jsonSame(item.metadata, { curriculumItemId: wanted.itemId });
    });
    if (!matches) {
      await sql`DELETE FROM catalog.collection_items WHERE section_id = ${sectionId}`;
      for (const item of items) await sql`
        INSERT INTO catalog.collection_items (section_id, resource_id, position, required, metadata)
        VALUES (${sectionId}, ${item.resourceId}, ${item.position}, ${item.required}, ${sql.json({ curriculumItemId: item.itemId })})
      `;
    }
  }
  return created;
}

async function main(): Promise<void> {
  const sql = postgres(databaseUrl!, { max: 1, prepare: false, connect_timeout: 10 });
  try {
    console.log("Reading existing catalog papers and curriculum identifiers.");
    const before = await counts(sql);
    let unavailableExistingIds: string[] = [];
    const existing = await sql<ResourceRow[]>`
      SELECT r.id::text AS id, r.external_id AS arxiv_id, r.owner_user_id::text AS owner_user_id
      FROM catalog.resources r WHERE r.type = 'paper' AND r.provider = 'arxiv' AND r.deleted_at IS NULL AND r.external_id IS NOT NULL
    `;
    const resourceRows = existing.flatMap((row) => {
      const id = normalizeArxivId(row.arxiv_id);
      return id ? [{ ...row, arxiv_id: id }] : [];
    });
    const ids = [...new Set([...resourceRows.map((row) => row.arxiv_id), ...curriculumIds])];
    console.log(`Fetching verified metadata for ${ids.length} arXiv IDs.`);
    const papers = await fetchCatalogPapers(ids);
    console.log(`Fetched verified metadata for ${papers.size} papers; applying catalog updates.`);
    const missingCurriculum = [...new Set(curriculumIds)].filter((id) => !papers.has(id));
    if (missingCurriculum.length) throw new Error(`arXiv metadata unavailable for curriculum IDs: ${missingCurriculum.join(", ")}`);
    let collectionsCreated = 0;
    const after = await sql.begin(async (tx) => {
      const resourceByArxivId = new Map<string, string>();
      for (const item of curriculum.items) if (item.type === "paper") {
        const paper = papers.get(item.arxivId)!;
        const curriculumData = associations.get(item.arxivId)!;
        const [resource] = await tx<{ id: string }[]>`
          INSERT INTO catalog.resources (owner_user_id, type, provider, external_id, canonical_url, title, description, visibility, status, metadata)
          VALUES (NULL, 'paper', 'arxiv', ${paper.arxivId}, ${`https://arxiv.org/abs/${paper.arxivId}`}, ${paper.title}, ${paper.abstract}, 'public', 'ready', ${tx.json({ catalogMetadataVerified: true, paperClass: "foundational", curriculum: curriculumData })})
          ON CONFLICT (provider, external_id) WHERE owner_user_id IS NULL AND external_id IS NOT NULL DO UPDATE SET
            type = 'paper', canonical_url = EXCLUDED.canonical_url, title = EXCLUDED.title, description = EXCLUDED.description, visibility = 'public', status = 'ready',
            metadata = catalog.resources.metadata || EXCLUDED.metadata,
            updated_at = CASE WHEN catalog.resources.type IS DISTINCT FROM 'paper' OR catalog.resources.canonical_url IS DISTINCT FROM EXCLUDED.canonical_url
              OR catalog.resources.title IS DISTINCT FROM EXCLUDED.title OR catalog.resources.description IS DISTINCT FROM EXCLUDED.description
              OR catalog.resources.metadata->>'paperClass' IS DISTINCT FROM 'foundational' THEN now() ELSE catalog.resources.updated_at END
          WHERE catalog.resources.type IS DISTINCT FROM EXCLUDED.type OR catalog.resources.canonical_url IS DISTINCT FROM EXCLUDED.canonical_url
            OR catalog.resources.title IS DISTINCT FROM EXCLUDED.title OR catalog.resources.description IS DISTINCT FROM EXCLUDED.description
            OR catalog.resources.visibility IS DISTINCT FROM 'public' OR catalog.resources.status IS DISTINCT FROM 'ready'
            OR catalog.resources.metadata IS DISTINCT FROM (catalog.resources.metadata || EXCLUDED.metadata)
          RETURNING id::text AS id
        `;
        const existingResource = resource ?? (await tx<{ id: string }[]>`
          SELECT id::text AS id FROM catalog.resources WHERE provider = 'arxiv' AND external_id = ${paper.arxivId} AND owner_user_id IS NULL AND deleted_at IS NULL LIMIT 1
        `)[0];
        if (!existingResource) throw new Error(`Could not create catalog resource ${paper.arxivId}`);
        resourceByArxivId.set(paper.arxivId, existingResource.id);
      }
      unavailableExistingIds = [...new Set(resourceRows.filter((row) => !papers.has(row.arxiv_id)).map((row) => row.arxiv_id))];
      for (const row of resourceRows) {
        const paper = papers.get(row.arxiv_id);
        if (paper) await upsertCatalogPaper(tx, row.id, paper);
      }
      const existingResourceIds = new Set(resourceRows.map((row) => row.id));
      for (const [arxivId, resourceId] of resourceByArxivId) if (!existingResourceIds.has(resourceId)) await upsertCatalogPaper(tx, resourceId, papers.get(arxivId)!);
      for (const [arxivId, resourceId] of resourceByArxivId) {
        const curriculumData = associations.get(arxivId)!;
        const curriculumMetadata = { paperClass: "foundational", curriculum: curriculumData };
        await tx`UPDATE catalog.resources SET metadata = metadata || ${tx.json(curriculumMetadata)} WHERE id = ${resourceId}
          AND metadata IS DISTINCT FROM (metadata || ${tx.json(curriculumMetadata)})`;
      }
      for (const track of curriculum.tracks) collectionsCreated += await upsertTrack(tx, track, resourceByArxivId);
      return counts(tx);
    });
    const presentRows = await sql<{ count: number }[]>`
      SELECT count(DISTINCT external_id)::int AS count FROM catalog.resources WHERE provider = 'arxiv' AND type = 'paper' AND deleted_at IS NULL AND external_id = ANY(${[...new Set(curriculumIds)]})
    `;
    console.log(JSON.stringify({ before, after, curriculumPapersPresent: presentRows[0]?.count ?? 0, curriculumPapersExpected: new Set(curriculumIds).size, collectionsCreated, unrepairedExistingIds: unavailableExistingIds }, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
