import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import { datasetRows, canonicalYoutubeId, type DatasetRow } from "@learnspace/shared/youtube-dataset";
import { scoreYoutubeQuality } from "@learnspace/shared/youtube-quality";
import { redisCommands, recommendationCatalogKey } from "@learnspace/shared/recommendation-cache";

const categoryConcepts: Record<string, string[]> = {
  "coding-programming": ["programming-computer-science"], "data-science-ai": ["data-science", "ai-machine-learning"],
  "ai-innovation": ["ai-machine-learning"], mathematics: ["mathematics-statistics"], "devops-cloud": ["devops-cloud"],
};
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export async function syncCuratedCatalog(db: ReturnType<typeof postgres>): Promise<number> {
  const file = process.env.CURRICULUM_PATH ?? resolve(fileURLToPath(new URL("../../../", import.meta.url)), "apps/web/public/data/learnspace_youtube_curriculum_master.csv");
  const concepts = await db<{ id: string; name: string; slug: string }[]>`SELECT id, name, slug FROM knowledge.concepts WHERE status = 'active'`;
  const aliases = await db<{ concept_id: string; normalized_alias: string }[]>`SELECT concept_id, normalized_alias FROM knowledge.concept_aliases`;
  const labels = new Map<string, string>(concepts.flatMap((concept) => [[normalize(concept.name), concept.id], [normalize(concept.slug), concept.id]]));
  for (const alias of aliases) if (normalize(alias.normalized_alias).length >= 4) labels.set(normalize(alias.normalized_alias), alias.concept_id);
  const imported = new Map<string, DatasetRow[]>();
  for await (const row of datasetRows(file)) {
    if (row.resource_type !== "video") continue;
    const id = canonicalYoutubeId(row.video_url || row.youtube_url || null);
    if (id && row.title?.trim()) imported.set(id, [...(imported.get(id) ?? []), row]);
  }
  let changed = 0;
  for (const [youtubeId, entries] of imported) {
    const row = entries[0]!;
    const categories = [...new Set(entries.map((entry) => entry.category_slug ?? ""))];
    const category = row.category_slug ?? "";
    const title = row.title!;
    const core = categories.flatMap((category) => categoryConcepts[category] ?? [category]).flatMap((slug) => concepts.filter((concept) => concept.slug === slug).map((concept) => concept.id));
    const evidence = normalize(entries.flatMap((entry) => [entry.title, entry.track, entry.coverage_notes]).filter(Boolean).join(" "));
    const matches = [...labels].filter(([label]) => label.length >= 4 && ` ${evidence} `.includes(` ${label} `)).map(([, id]) => id);
    const conceptWeights = new Map<string, number>([...core.map((id) => [id, .65] as const), ...matches.map((id) => [id, .9] as const)]);
    if (!conceptWeights.size) continue;
    const hash = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
    const description = [row.coverage_notes, row.track].filter(Boolean).join(". ") || null;
    const level = /advanced|specializ/i.test(row.learning_stage ?? "") ? "advanced" : /intermediate/i.test(row.learning_stage ?? "") ? "intermediate" : /foundation/i.test(row.learning_stage ?? "") ? "beginner" : null;
    const quality = scoreYoutubeQuality({ title, description, channelTitle: row.channel || null, durationMs: null, publishedAt: null, viewCount: null, likeCount: null, commentCount: null, metricsCapturedAt: null }, new Date());
    const metadata = { curatedCategory: category, curatedCategories: categories, curriculumHash: hash, curriculumRole: row.curriculum_role, learningStage: row.learning_stage, subtopic: row.track, estimatedLevel: level, coverageNotes: row.coverage_notes, thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` };
    const updated = await db.begin(async (tx) => {
      const [resource] = await tx<{ id: string }[]>`
        INSERT INTO catalog.resources (type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata)
        VALUES ('video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, ${title}, ${description}, ${/english/i.test(row.language ?? "") ? "en" : null}, 'public', 'ready', ${quality.finalQualityScore}, ${tx.json(metadata)})
        ON CONFLICT (provider, external_id) WHERE owner_user_id IS NULL AND external_id IS NOT NULL DO UPDATE SET title = CASE WHEN catalog.resources.metadata ? 'curriculumHash' THEN EXCLUDED.title ELSE catalog.resources.title END, description = CASE WHEN catalog.resources.metadata ? 'curriculumHash' THEN EXCLUDED.description ELSE catalog.resources.description END, metadata = catalog.resources.metadata || EXCLUDED.metadata, updated_at = now()
          WHERE catalog.resources.metadata->>'curriculumHash' IS DISTINCT FROM ${hash} AND catalog.resources.deleted_at IS NULL
        RETURNING id
      `;
      if (!resource) return false;
      await tx`INSERT INTO catalog.video_details (resource_id, youtube_id, channel_title) VALUES (${resource.id}, ${youtubeId}, ${row.channel || null}) ON CONFLICT (resource_id) DO UPDATE SET channel_title = COALESCE(catalog.video_details.channel_title, EXCLUDED.channel_title)`;
      await tx`DELETE FROM catalog.resource_concepts WHERE resource_id = ${resource.id} AND source = 'curated-curriculum-v1'`;
      for (const [conceptId, relevance] of conceptWeights) await tx`INSERT INTO catalog.resource_concepts (resource_id, concept_id, source, relevance, is_primary) VALUES (${resource.id}, ${conceptId}, 'curated-curriculum-v1', ${relevance}, ${relevance === .9})`;
      return true;
    });
    if (updated) changed++;
  }
  const removed = await db.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`UPDATE catalog.resources SET metadata = metadata - ARRAY['curatedCategory','curatedCategories','curriculumHash','curriculumRole','learningStage','coverageNotes'], updated_at = now() WHERE metadata ? 'curriculumHash' AND external_id <> ALL(${[...imported.keys()]}::text[]) RETURNING id`;
    if (rows.length) await tx`DELETE FROM catalog.resource_concepts WHERE resource_id = ANY(${rows.map((row) => row.id)}::uuid[]) AND source = 'curated-curriculum-v1'`;
    return rows.length;
  });
  changed += removed;
  if (changed) await redisCommands([["INCR", recommendationCatalogKey]]);
  return changed;
}
