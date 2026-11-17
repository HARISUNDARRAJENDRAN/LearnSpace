import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { createSession } from "../../lib/auth/repository";

type Database = ReturnType<typeof postgres>;

export type ResearchFixture = {
  userId: string;
  email: string;
  sessionToken: string;
  cpuResourceId: string;
  cpuVersionId: string;
  gpuResourceId: string;
  gpuVersionId: string;
  citedResourceId: string;
  citedVersionId: string;
  originalCpuVersionId: string | null;
  originalCpuStatus: string;
  /** Whether the fixture created the XGBoost catalogue row (CI's seed has no research catalogue) and so removes it. */
  createdCpu: boolean;
  authorId: string;
  referenceMarker: string;
};

const cpuPassages = [
  { type: "heading", content: "1. Introduction", section: "introduction", page: 1, heading: ["1. Introduction"], metadata: {} },
  { type: "paragraph", content: "XGBoost is a scalable system for tree boosting. It combines regularized objectives with systems techniques for efficient learning [1].", section: "introduction", page: 1, heading: ["1. Introduction"], metadata: { citations: [1] } },
  { type: "heading", content: "3. Tree Boosting in Practice", section: "tree-boosting", page: 2, heading: ["3. Tree Boosting in Practice"], metadata: {} },
  { type: "paragraph", content: "At each iteration, a new tree is added to improve the prediction. The objective balances the loss with a penalty on the number and size of leaves [1].", section: "tree-boosting", page: 2, heading: ["3. Tree Boosting in Practice"], metadata: { citations: [1] } },
  { type: "equation", content: "$$Obj = \sum_i l(y_i, \hat{y}_i) + \sum_k \Omega(f_k)$$", section: "tree-boosting", page: 2, heading: ["3. Tree Boosting in Practice"], metadata: { latex: "Obj = \\sum_i l(y_i, \\hat{y}_i) + \\sum_k \\Omega(f_k)", label: "Eq. 1" } },
  { type: "heading", content: "4. Split Finding Algorithms", section: "split-finding", page: 2, heading: ["4. Split Finding Algorithms"], metadata: {} },
  { type: "paragraph", content: "The exact greedy algorithm enumerates candidate split points. A weighted quantile sketch proposes approximate candidates while preserving useful statistics [1].", section: "split-finding", page: 2, heading: ["4. Split Finding Algorithms"], metadata: { citations: [1] } },
  { type: "paragraph", content: "The system also uses sparsity-aware traversal, cache access patterns, data compression, and sharding to scale tree learning.", section: "split-finding", page: 2, heading: ["4. Split Finding Algorithms"], metadata: {} },
];

const gpuPassages = [
  { type: "heading", content: "1. Core Mechanism", section: "core-mechanism", page: 1, heading: ["1. Core Mechanism"], metadata: {} },
  { type: "paragraph", content: "The method trains a diffusion model over billions of examples using a distributed GPU cluster. Each training step updates model parameters from a large batch of noisy samples.", section: "core-mechanism", page: 1, heading: ["1. Core Mechanism"], metadata: {} },
  { type: "heading", content: "2. Practical Limits", section: "practical-limits", page: 2, heading: ["2. Practical Limits"], metadata: {} },
  { type: "paragraph", content: "Faithful reproduction requires multi-node GPU training and a large image corpus. A CPU-sized toy can illustrate one denoising step, but it cannot reproduce the full training system.", section: "practical-limits", page: 2, heading: ["2. Practical Limits"], metadata: {} },
];

async function insertVersion(db: Database, resourceId: string, versionId: string, passages: typeof cpuPassages) {
  const sourceSha = createHash("sha256").update(versionId).digest("hex");
  const [{ version_no: versionNo }] = await db<[{ version_no: number }]>`SELECT coalesce(max(version_no), 0) + 1 AS version_no FROM catalog.resource_versions WHERE resource_id = ${resourceId}`;
  await db`INSERT INTO catalog.resource_versions
    (id, resource_id, version_no, source_sha256, content_sha256, raw_object_key, mime_type, parser_name, parser_version, processing_status, fetched_at, ready_at)
    VALUES (${versionId}, ${resourceId}, ${versionNo}, ${sourceSha}, ${sourceSha}, ${`e2e/research/${versionId}`}, 'application/pdf', 'e2e-fixture', '1', 'ready', now(), now())`;
  for (const [ordinal, passage] of passages.entries()) {
    const hash = createHash("sha256").update(passage.content).digest("hex");
    await db`INSERT INTO retrieval.resource_chunks
      (resource_version_id, ordinal, chunk_type, content, content_sha256, token_count, language, page_from, page_to, heading_path, anchor, metadata)
      VALUES (${versionId}, ${ordinal}, ${passage.type}, ${passage.content}, ${hash}, ${Math.max(1, Math.ceil(passage.content.length / 4))}, 'en', ${passage.page}, ${passage.page}, ${passage.heading}, ${JSON.stringify({ page: passage.page, sectionId: passage.section })}::jsonb, ${JSON.stringify(passage.metadata)}::jsonb)`;
  }
}

/** A real parsed paper fixture; XGBoost is the first beginner-path paper and stays shared catalogue data. */
export async function seedResearchFixture(db: Database, saved = false): Promise<ResearchFixture> {
  let [cpu] = await db<{ id: string; current_version_id: string | null; status: string }[]>`
    SELECT id, current_version_id, status FROM catalog.resources r
    JOIN catalog.paper_details p ON p.resource_id = r.id
    WHERE p.arxiv_id = '1603.02754' AND r.deleted_at IS NULL LIMIT 1`;
  const createdCpu = !cpu;
  if (!cpu) {
    // The research catalogue is filled by a backfill against arXiv, which CI's seeded database never runs; this is its row.
    const [created] = await db<{ id: string }[]>`
      INSERT INTO catalog.resources (type, provider, external_id, canonical_url, title, visibility, status, metadata)
      VALUES ('paper', 'arxiv', '1603.02754', 'https://arxiv.org/abs/1603.02754', 'XGBoost: A Scalable Tree Boosting System', 'public', 'ready',
        '{"curriculum": {"itemIds": ["arxiv:1603.02754"], "trackIds": ["ml-foundations"]}, "paperClass": "foundational", "catalogMetadataVerified": true}'::jsonb)
      RETURNING id`;
    await db`INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, venue, publication_date, primary_category, pdf_source_url)
      VALUES (${created!.id}, '1603.02754', 'Tree boosting is a highly effective and widely used machine learning method. In this paper, we describe a scalable end-to-end tree boosting system called XGBoost.', 'arXiv', '2016-03-09', 'cs.LG', 'https://arxiv.org/pdf/1603.02754')`;
    cpu = { id: created!.id, current_version_id: null, status: "ready" };
  }

  const userId = randomUUID();
  const email = `research-e2e-${userId}@example.test`;
  const cpuVersionId = randomUUID();
  const gpuResourceId = randomUUID();
  const gpuVersionId = randomUUID();
  const citedResourceId = randomUUID();
  const citedVersionId = randomUUID();
  const authorId = randomUUID();
  const runTag = randomUUID();
  const referenceMarker = `Research E2E reference ${runTag}`;
  const [{ ordinal: referenceOrdinal }] = await db<[{ ordinal: number }]>`
    SELECT coalesce(max(ordinal), 0) + 1 AS ordinal
    FROM catalog.paper_references WHERE paper_resource_id = ${cpu.id}`;
  const [{ ordinal: cpuAuthorOrdinal }] = await db<[{ ordinal: number }]>`
    SELECT coalesce(max(ordinal), -1) + 1 AS ordinal
    FROM catalog.paper_authors WHERE paper_resource_id = ${cpu.id}`;

  await db.begin(async (tx) => {
    await tx`INSERT INTO identity.users (id, email, email_verified, status, display_name, locale, timezone, subscription_tier)
      VALUES (${userId}, ${email}, true, 'active', 'Research E2E Learner', 'en', 'UTC', 'free')`;
    await tx`INSERT INTO identity.user_settings (user_id, onboarding_completed_at, onboarding_version, first_application_visit_at, learning_preferences)
      VALUES (${userId}, now(), 1, now(), '{"selfReportedLevel":"beginner","preferredFormats":["clear_explanations"]}'::jsonb)`;
    await insertVersion(tx as unknown as Database, cpu.id, cpuVersionId, cpuPassages);
    await tx`UPDATE catalog.resources SET current_version_id = ${cpuVersionId}, status = 'ready' WHERE id = ${cpu.id}`;

    await tx`INSERT INTO catalog.resources (id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata)
      VALUES (${gpuResourceId}, 'paper', 'arxiv', ${`research-e2e-gpu-${runTag}`}, ${`https://arxiv.org/abs/9999.${runTag.slice(0, 5)}`}, 'GPU-dependent distributed boosting', 'A GPU-only distributed boosting method for billions of examples.', 'en', 'public', 'ready', 0.91, '{"test":true}'::jsonb)`;
    await tx`INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, venue, publication_date)
      VALUES (${gpuResourceId}, ${`9999.${runTag.slice(0, 5)}`}, 'Faithful training requires a distributed GPU cluster and billions of examples.', 'Research E2E', current_date)`;
    await insertVersion(tx as unknown as Database, gpuResourceId, gpuVersionId, gpuPassages);
    await tx`UPDATE catalog.resources SET current_version_id = ${gpuVersionId} WHERE id = ${gpuResourceId}`;

    await tx`INSERT INTO catalog.resources (id, type, provider, external_id, canonical_url, title, description, language, visibility, status, quality_score, metadata)
      VALUES (${citedResourceId}, 'paper', 'arxiv', ${`research-e2e-cited-${runTag}`}, ${`https://arxiv.org/abs/8888.${runTag.slice(0, 5)}`}, 'A Verified Tree Boosting Reference', 'A resolved reference paper for the Research browser test.', 'en', 'public', 'ready', 0.8, '{"test":true}'::jsonb)`;
    await tx`INSERT INTO catalog.paper_details (resource_id, arxiv_id, abstract, venue, publication_date)
      VALUES (${citedResourceId}, ${`8888.${runTag.slice(0, 5)}`}, 'A verified paper about tree boosting.', 'Research E2E', current_date)`;
    await insertVersion(tx as unknown as Database, citedResourceId, citedVersionId, gpuPassages);
    await tx`UPDATE catalog.resources SET current_version_id = ${citedVersionId} WHERE id = ${citedResourceId}`;

    await tx`INSERT INTO catalog.authors (id, normalized_name, preferred_name) VALUES (${authorId}, 'research e2e author', 'Research E2E Author')`;
    await tx`INSERT INTO catalog.paper_authors (paper_resource_id, author_id, ordinal) VALUES (${cpu.id}, ${authorId}, ${cpuAuthorOrdinal}), (${gpuResourceId}, ${authorId}, 0), (${citedResourceId}, ${authorId}, 0)`;
    await tx`INSERT INTO catalog.paper_references (paper_resource_id, ordinal, raw_reference, cited_resource_id, cited_arxiv_id, resolution_status, confidence, metadata)
      VALUES (${cpu.id}, ${referenceOrdinal}, ${referenceMarker}, ${citedResourceId}, ${`8888.${runTag.slice(0, 5)}`}, 'resolved', 1, '{"title":"A Verified Tree Boosting Reference","authors":["Research E2E Author"],"year":2024,"venue":"Research E2E","abstract":"A verified paper about tree boosting."}'::jsonb)`;
    if (saved) await tx`INSERT INTO catalog.library_items (user_id, resource_id, status, source) VALUES (${userId}, ${cpu.id}, 'saved', 'user')`;
  });

  const fixture: ResearchFixture = { userId, email, sessionToken: "", cpuResourceId: cpu.id, cpuVersionId, gpuResourceId, gpuVersionId, citedResourceId, citedVersionId, originalCpuVersionId: cpu.current_version_id, originalCpuStatus: cpu.status, createdCpu, authorId, referenceMarker };
  try {
    fixture.sessionToken = (await createSession(userId, { userAgent: "research-e2e" }, process.env.AUTH_SECRET ?? "")).token;
    return fixture;
  } catch (error) {
    await cleanupResearchFixture(db, fixture);
    throw error;
  }
}

export async function cleanupResearchFixture(db: Database, fixture: ResearchFixture): Promise<void> {
  const versions = [fixture.cpuVersionId, fixture.gpuVersionId, fixture.citedVersionId];
  await db`DELETE FROM catalog.library_items WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM discovery.discovery_interactions WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM discovery.recommendation_impressions WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM discovery.recommendation_candidates WHERE recommendation_run_id IN (SELECT id FROM discovery.recommendation_runs WHERE user_id = ${fixture.userId})`;
  await db`DELETE FROM discovery.recommendation_runs WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM discovery.user_concept_affinity WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM practice.coding_events WHERE attempt_id IN (SELECT id FROM practice.coding_attempts WHERE user_id = ${fixture.userId})`;
  await db`DELETE FROM practice.coding_submissions WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM practice.coding_attempts WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM practice.coding_problems WHERE created_by = ${fixture.userId}`;
  await db`DELETE FROM practice.coding_mastery WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM practice.paper_coding_profiles WHERE resource_version_id IN ${db(versions)}`;
  await db`DELETE FROM study.video_notes WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM study.session_transcript WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM retrieval.answer_cache WHERE resource_version_id IN ${db(versions)}`;
  await db`DELETE FROM retrieval.citations WHERE resource_version_id IN ${db(versions)}`;
  await db`DELETE FROM retrieval.retrieved_chunks WHERE retrieval_run_id IN (SELECT id FROM retrieval.retrieval_runs WHERE user_id = ${fixture.userId})`;
  await db`DELETE FROM retrieval.retrieval_runs WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM agent.model_invocations WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id = ${fixture.userId})`;
  await db`UPDATE study.tutor_messages SET source_message_id = NULL WHERE thread_id IN (SELECT id FROM study.tutor_threads WHERE user_id = ${fixture.userId})`;
  await db`DELETE FROM study.tutor_messages WHERE thread_id IN (SELECT id FROM study.tutor_threads WHERE user_id = ${fixture.userId})`;
  await db`DELETE FROM agent.agent_steps WHERE agent_run_id IN (SELECT id FROM agent.agent_runs WHERE user_id = ${fixture.userId})`;
  await db`DELETE FROM agent.agent_runs WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM study.tutor_threads WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM ops.outbox_events WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM ops.idempotency_records WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM ops.rate_limit_counters WHERE key LIKE ${`learnspace:%:${fixture.userId}`}`;
  await db`DELETE FROM activity.activity_events WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM study.session_checkpoints WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${fixture.userId})`;
  await db`DELETE FROM study.session_context_snapshots WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${fixture.userId})`;
  await db`DELETE FROM study.user_resource_progress WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM study.schedule_items WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM study.focus_sessions WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM study.mastery_checks WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${fixture.userId})`;
  await db`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ${fixture.userId})`;
  await db`DELETE FROM study.study_sessions WHERE user_id = ${fixture.userId}`;
  await db`DELETE FROM catalog.paper_references WHERE paper_resource_id = ${fixture.cpuResourceId} AND raw_reference = ${fixture.referenceMarker}`;
  await db`DELETE FROM catalog.paper_authors WHERE author_id = ${fixture.authorId}`;
  await db`DELETE FROM catalog.authors WHERE id = ${fixture.authorId}`;
  await db`DELETE FROM catalog.resource_concepts WHERE resource_id IN (${fixture.gpuResourceId}, ${fixture.citedResourceId})`;
  await db`UPDATE catalog.resources SET current_version_id = ${fixture.originalCpuVersionId}, status = ${fixture.originalCpuStatus} WHERE id = ${fixture.cpuResourceId}`;
  await db`UPDATE catalog.resources SET current_version_id = NULL WHERE id IN (${fixture.gpuResourceId}, ${fixture.citedResourceId})`;
  await db`DELETE FROM retrieval.resource_chunks WHERE resource_version_id IN ${db(versions)}`;
  await db`DELETE FROM catalog.resource_versions WHERE id IN ${db(versions)}`;
  await db`DELETE FROM catalog.paper_details WHERE resource_id IN (${fixture.gpuResourceId}, ${fixture.citedResourceId})`;
  await db`DELETE FROM catalog.resources WHERE id IN (${fixture.gpuResourceId}, ${fixture.citedResourceId})`;
  if (fixture.createdCpu) {
    await db`DELETE FROM catalog.paper_references WHERE paper_resource_id = ${fixture.cpuResourceId}`;
    await db`DELETE FROM catalog.paper_details WHERE resource_id = ${fixture.cpuResourceId}`;
    await db`DELETE FROM catalog.resources WHERE id = ${fixture.cpuResourceId}`;
  }
  await db`DELETE FROM identity.users WHERE id = ${fixture.userId}`;
}

/** A three-page PDF lets tests drive the real reader without depending on arXiv or object storage. */
export function tinyPaperPdf(): Buffer {
  const content = "BT /F1 12 Tf 72 700 Td (Objective = loss + complexity penalty) Tj ET";
  const textStream = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  const blankStream = "<< /Length 0 >>\nstream\n\nendstream";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 8 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 9 0 R >>",
    blankStream,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    textStream,
    blankStream,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
