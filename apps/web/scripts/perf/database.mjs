import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
const target = process.env.DATABASE_MIGRATOR_URL;
assert(target && ["localhost", "127.0.0.1"].includes(new URL(target).hostname), "Local database required");
const db = postgres(target, { max: 1, prepare: false });
const app = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const output = process.argv[2] ?? "/tmp/learnspace-perf/database.json";
const report = { measuredAt: new Date().toISOString(), method: "Representative hot query shapes, app role + user RLS, EXPLAIN ANALYZE BUFFERS FORMAT JSON. Not a complete capture of every loader query; no cache flush.", plans: {} };
try {
  const [user] = await db`SELECT id FROM identity.users WHERE email = 'research-ui@learnspace.local'`;
  assert(user);
  const [paper] = await db`SELECT id, current_version_id FROM catalog.resources WHERE id = 'e5a565d3-380c-467b-8876-48b247628885'`;
  assert(paper?.current_version_id);
  report.ingestion = await db`SELECT r.id AS resource_id, r.title, v.parser_name, v.parser_version, v.metadata->'timings' AS timings, v.created_at FROM catalog.resources r JOIN catalog.resource_versions v ON v.id = r.current_version_id WHERE r.type = 'paper' AND v.metadata ? 'timings' ORDER BY v.created_at`;
  report.sourceRuns = await db`SELECT query_text, status, context_snapshot->'partialFailures' AS failures, jsonb_array_length(context_snapshot->'ephemeralCandidates') AS candidates, created_at FROM discovery.recommendation_runs WHERE user_id=${user.id} AND query_text IN ('attention mechanisms in transformers','Adam stochastic optimization','energy based recurrent reasoning','graph neural networks','diffusion transformer models') ORDER BY created_at DESC LIMIT 10`;
  report.cardinality = await db`SELECT (SELECT count(*) FROM catalog.resources) AS resources, (SELECT count(*) FROM retrieval.resource_chunks) AS chunks, (SELECT count(*) FROM study.study_sessions) AS sessions`;
  report.modelUsage = await db`SELECT purpose, count(*) AS calls, count(*) FILTER (WHERE cached_tokens > 0) AS cached_calls, percentile_disc(0.5) WITHIN GROUP (ORDER BY first_output_ms) AS first_output_p50, percentile_disc(0.95) WITHIN GROUP (ORDER BY first_output_ms) AS first_output_p95, sum(input_tokens) AS input_tokens, sum(cached_tokens) AS cached_tokens, sum(output_tokens) AS output_tokens FROM agent.model_invocations GROUP BY purpose` .catch((error) => ({ unavailable: error.code }));
  await app.begin(async (tx) => {
    await tx`SELECT set_config('app.user_id', ${user.id}, true)`;
    const queries = {
      "search-learn": tx`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id,title,description,type,provider FROM catalog.resources WHERE (owner_user_id = ${user.id} OR visibility IN ('public','unlisted')) AND type = 'video' AND status = 'ready' AND deleted_at IS NULL AND NOT (metadata ? 'curriculumHash') AND (title ILIKE '%python%' OR description ILIKE '%python%') ORDER BY quality_score DESC,updated_at DESC LIMIT 6`,
      "search-research": tx`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT r.id,r.title,r.description,p.abstract FROM catalog.resources r JOIN catalog.paper_details p ON p.resource_id=r.id WHERE r.type='paper' AND (r.owner_user_id=${user.id} OR r.visibility IN ('public','unlisted')) AND r.status IN ('ready','processing','pending') AND r.deleted_at IS NULL AND (r.title ILIKE '%attention%' OR r.description ILIKE '%attention%' OR p.abstract ILIKE '%attention%') ORDER BY r.quality_score DESC,p.publication_date DESC,r.updated_at DESC LIMIT 8`,
      "research-home": tx`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT r.*,p.* FROM catalog.resources r JOIN catalog.paper_details p ON p.resource_id=r.id WHERE r.type='paper' AND (r.owner_user_id=${user.id} OR r.visibility IN ('public','unlisted')) AND r.status IN ('ready','processing','pending') AND r.deleted_at IS NULL ORDER BY r.quality_score DESC,p.publication_date DESC,r.updated_at DESC LIMIT 100`,
      "research-discover": tx`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT p.arxiv_id,r.id,s.status,s.progress_pct,s.last_opened_at FROM catalog.paper_details p JOIN catalog.resources r ON r.id=p.resource_id LEFT JOIN study.user_resource_progress s ON s.resource_id=r.id AND s.user_id=${user.id} WHERE p.arxiv_id IN ('1706.03762','1301.3781','1412.6980') AND r.deleted_at IS NULL AND (r.owner_user_id=${user.id} OR r.visibility IN ('public','unlisted'))`,
      "research-library": tx`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT r.*,p.*,l.added_at FROM catalog.library_items l JOIN catalog.resources r ON r.id=l.resource_id JOIN catalog.paper_details p ON p.resource_id=r.id WHERE l.user_id=${user.id} AND l.status='saved' AND r.type='paper' AND r.deleted_at IS NULL ORDER BY l.added_at DESC`,
      "paper-content": tx`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT r.*,p.*,v.* FROM catalog.resources r JOIN catalog.paper_details p ON p.resource_id=r.id LEFT JOIN catalog.resource_versions v ON v.id=r.current_version_id WHERE r.id=${paper.id} AND r.type='paper' AND r.deleted_at IS NULL AND (r.owner_user_id=${user.id} OR r.visibility IN ('public','unlisted')) LIMIT 1`,
      "paper-passages": tx`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM retrieval.resource_chunks WHERE resource_version_id=${paper.current_version_id} ORDER BY ordinal`,
      "paper-voice-retrieval": tx`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id,ordinal,content,token_count,heading_path,page_from,anchor,metadata,ts_rank_cd(search_tsv,to_tsquery('simple','learning | energy')) AS lexical FROM retrieval.resource_chunks WHERE resource_version_id=${paper.current_version_id} ORDER BY ordinal`,
      "video-tutor-retrieval": tx`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id,ordinal,content,start_ms,end_ms FROM retrieval.resource_chunks WHERE resource_version_id=(SELECT current_version_id FROM catalog.resources WHERE id='7c8d9b63-3d3b-40b8-a755-bff1e48d2ac4') ORDER BY ordinal`,
      "notes-load": tx`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM study.video_notes WHERE user_id=${user.id} AND resource_id=${paper.id}`,
      "sidebar-sessions": tx`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT s.*,r.title,r.type FROM study.study_sessions s LEFT JOIN catalog.resources r ON r.id=s.active_resource_id WHERE s.user_id=${user.id} AND s.status <> 'abandoned' ORDER BY s.last_active_at DESC LIMIT 50`,
    };
    for (const [name, query] of Object.entries(queries)) {
      try { report.plans[name] = (await query)[0]["QUERY PLAN"][0]; }
      catch (error) { report.plans[name] = { error: error.code, message: error.message }; throw error; }
    }
  });
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally { await app.end(); await db.end(); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`); console.log(JSON.stringify({ failure: report.failure, plans: Object.fromEntries(Object.entries(report.plans).map(([name, plan]) => [name, plan["Execution Time"] ?? plan.error])) })); }
