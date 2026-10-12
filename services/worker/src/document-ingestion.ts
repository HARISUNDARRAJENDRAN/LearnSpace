import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import postgres from "postgres";
import {
  deletePrivateObject,
  MAX_PRIVATE_DOCUMENT_BYTES,
  PRIVATE_UPLOAD_DELETE_GRACE_SECONDS,
  privateDocumentKey,
  putPrivateObject,
  readPrivateObject,
} from "@learnspace/shared/private-storage";

type SqlClient = ReturnType<typeof postgres>;
type JsonObject = Record<string, postgres.JSONValue | undefined>;
type DocumentJob = {
  id: string;
  payload: JsonObject;
  trace_id: string | null;
};
type UploadMetadata = {
  versionId: string;
  pendingObjectKey: string;
  byteSize: number;
  state: string;
};
type ExtractedChunk = { content: string; page: number; sha256: string; tokenCount: number };

const MAX_PDF_PAGES = 500;
const MAX_EXTRACTED_CHARACTERS = 2_000_000;
const CHUNK_SIZE = 1_500;
const CHUNK_OVERLAP = 150;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function uploadMetadata(value: unknown): UploadMetadata | null {
  const metadata = objectValue(value);
  const upload = objectValue(metadata?.documentUpload);
  if (
    typeof upload?.versionId !== "string"
    || !UUID.test(upload.versionId)
    || typeof upload.pendingObjectKey !== "string"
    || typeof upload.byteSize !== "number"
    || !Number.isSafeInteger(upload.byteSize)
    || typeof upload.state !== "string"
  ) return null;
  return upload as UploadMetadata;
}

function jobIds(job: DocumentJob) {
  const userId = job.payload.userId;
  const resourceId = job.payload.resourceId;
  const versionId = job.payload.versionId;
  if (typeof userId !== "string" || !UUID.test(userId)
    || typeof resourceId !== "string" || !UUID.test(resourceId)
    || typeof versionId !== "string" || !UUID.test(versionId)) {
    throw new Error("Document ingestion job identifiers are invalid");
  }
  return { userId, resourceId, versionId };
}

export function hasPdfHeader(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 1024)).toString("latin1").includes("%PDF-");
}

export async function extractPdfChunks(bytes: Uint8Array): Promise<{ chunks: ExtractedChunk[]; pageCount: number; contentSha256: string }> {
  if (!hasPdfHeader(bytes)) throw new Error("Uploaded document is not a PDF");
  const loadingTask = getDocument({ data: bytes, disableFontFace: true, enableXfa: false, stopAtErrors: true, verbosity: 0 });
  try {
    const document = await loadingTask.promise;
    if (document.numPages < 1 || document.numPages > MAX_PDF_PAGES) throw new Error("PDF page count is outside the supported limit");
    const chunks: ExtractedChunk[] = [];
    const fullText: string[] = [];
    let extractedCharacters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      extractedCharacters += text.length;
      if (extractedCharacters > MAX_EXTRACTED_CHARACTERS) throw new Error("PDF extracted text exceeds the supported limit");
      fullText.push(text);
      for (let start = 0; start < text.length; start += CHUNK_SIZE - CHUNK_OVERLAP) {
        const chunkText = text.slice(start, start + CHUNK_SIZE).trim();
        if (chunkText) chunks.push({
          content: chunkText,
          page: pageNumber,
          sha256: createHash("sha256").update(chunkText).digest("hex"),
          tokenCount: Math.max(1, Math.ceil(chunkText.length / 4)),
        });
        if (start + CHUNK_SIZE >= text.length) break;
      }
    }
    if (!chunks.length) throw new Error("PDF contains no extractable text");
    return {
      chunks,
      pageCount: document.numPages,
      contentSha256: createHash("sha256").update(fullText.join("\n\n")).digest("hex"),
    };
  } finally {
    await loadingTask.destroy();
  }
}

export async function ingestUploadedPdf(sql: SqlClient, job: DocumentJob): Promise<JsonObject> {
  const { userId, resourceId, versionId } = jobIds(job);
  const pendingPrefix = `pending/${userId}/${resourceId}/${versionId}/`;
  const privateKey = privateDocumentKey(userId, resourceId, versionId);
  const [resource] = await sql<{ metadata: JsonObject; current_version_id: string | null; deleted_at: Date | null }[]>`
    SELECT metadata, current_version_id, deleted_at
    FROM catalog.resources
    WHERE id = ${resourceId} AND owner_user_id = ${userId} AND provider = 'user_upload' AND type = 'pdf'
  `;
  if (!resource) throw new Error("Document upload record is unavailable");
  if (resource.deleted_at) {
    return { resourceId, status: "deleted" };
  }
  if (resource.current_version_id === versionId) {
    return { resourceId, status: "ready" };
  }
  const existingUpload = uploadMetadata(resource.metadata);
  const upload = existingUpload;
  if (
    !upload
    || upload.versionId !== versionId
    || upload.state !== "queued"
    || upload.byteSize < 1
    || upload.byteSize > MAX_PRIVATE_DOCUMENT_BYTES
    || !upload.pendingObjectKey.startsWith(pendingPrefix)
    || !/^[0-9a-f-]{36}\.pdf$/i.test(upload.pendingObjectKey.slice(pendingPrefix.length))
  ) throw new Error("Document upload metadata is invalid");

  const source = await readPrivateObject(upload.pendingObjectKey, MAX_PRIVATE_DOCUMENT_BYTES);
  if (source.bytes.byteLength !== upload.byteSize || source.contentType !== "application/pdf") {
    throw new Error("Stored document does not match its upload metadata");
  }
  const sourceSha256 = createHash("sha256").update(source.bytes).digest("hex");
  const extracted = await extractPdfChunks(source.bytes);

  const ready = await sql.begin(async (tx) => {
    const [current] = await tx<{ metadata: JsonObject; deleted_at: Date | null; current_version_id: string | null; created_at: Date }[]>`
      SELECT metadata, deleted_at, current_version_id, created_at
      FROM catalog.resources
      WHERE id = ${resourceId} AND owner_user_id = ${userId} AND provider = 'user_upload' AND type = 'pdf'
      FOR UPDATE
    `;
    if (!current || current.deleted_at) return false;
    const currentUpload = uploadMetadata(current.metadata);
    if (current.current_version_id === versionId) return true;
    if (!currentUpload || currentUpload.versionId !== versionId || currentUpload.state !== "queued" || currentUpload.pendingObjectKey !== upload.pendingObjectKey) {
      throw new Error("Document upload is no longer queued");
    }
    const [existing] = await tx<{ processing_status: string }[]>`
      SELECT processing_status FROM catalog.resource_versions WHERE id = ${versionId} AND resource_id = ${resourceId}
    `;
    if (existing) {
      if (existing.processing_status === "ready") return true;
      throw new Error("Document version already exists in an incomplete state");
    }

    // Keep the permanent object copy and version registration under the same
    // resource-row lock used by deletion, so neither operation can miss it.
    await putPrivateObject(privateKey, source.bytes, sourceSha256);

    const [versionNo] = await tx<{ value: number }[]>`
      SELECT coalesce(max(version_no), 0) + 1 AS value FROM catalog.resource_versions WHERE resource_id = ${resourceId}
    `;
    await tx`
      INSERT INTO catalog.resource_versions
        (id, resource_id, version_no, source_sha256, content_sha256, raw_object_key, mime_type, byte_size, parser_name, parser_version, processing_status, fetched_at, ready_at)
      VALUES
        (${versionId}, ${resourceId}, ${versionNo?.value ?? 1}, ${sourceSha256}, ${extracted.contentSha256}, ${privateKey}, 'application/pdf', ${source.bytes.byteLength}, 'pdfjs-dist', '6', 'ready', now(), now())
    `;
    for (const [ordinal, chunk] of extracted.chunks.entries()) {
      await tx`
        INSERT INTO retrieval.resource_chunks
          (resource_version_id, ordinal, chunk_type, content, content_sha256, token_count, page_from, page_to)
        VALUES (${versionId}, ${ordinal}, 'text', ${chunk.content}, ${chunk.sha256}, ${chunk.tokenCount}, ${chunk.page}, ${chunk.page})
      `;
    }
    await tx`
      INSERT INTO retrieval.ingestion_runs
        (resource_id, resource_version_id, pipeline_version, status, requested_by, started_at, completed_at, trace_id, metrics)
      VALUES
        (${resourceId}, ${versionId}, 'pdfjs-v1', 'completed', 'user_upload', now(), now(), ${job.trace_id}, ${tx.json({ pages: extracted.pageCount, chunks: extracted.chunks.length, extractedCharacters: extracted.chunks.reduce((total, chunk) => total + chunk.content.length, 0) })})
      ON CONFLICT (resource_version_id, pipeline_version) DO NOTHING
    `;
    const metadata = objectValue(current.metadata) ?? {};
    await tx`
      UPDATE catalog.resources
      SET status = 'ready', current_version_id = ${versionId},
          metadata = ${tx.json({ ...metadata, documentUpload: { ...currentUpload, state: "ready", pageCount: extracted.pageCount } })},
          updated_at = now()
      WHERE id = ${resourceId} AND owner_user_id = ${userId}
    `;
    await tx`
      INSERT INTO ops.outbox_events
        (aggregate_type, aggregate_id, event_type, schema_version, user_id, payload, trace_id, available_at)
      VALUES
        ('resource', ${resourceId}, 'resource.file_deletion_requested', 1, ${userId},
          ${tx.json({ resourceId, objectKeys: [upload.pendingObjectKey] })}, ${job.trace_id},
          ${new Date(current.created_at.getTime() + PRIVATE_UPLOAD_DELETE_GRACE_SECONDS * 1000)})
    `;
    return true;
  });

  return { resourceId, status: ready ? "ready" : "deleted", pageCount: extracted.pageCount, chunkCount: extracted.chunks.length };
}

export async function deleteUploadedObjects(sql: SqlClient, job: DocumentJob): Promise<JsonObject> {
  const userId = job.payload.userId;
  const resourceId = job.payload.resourceId;
  if (typeof userId !== "string" || !UUID.test(userId) || typeof resourceId !== "string" || !UUID.test(resourceId)) {
    throw new Error("Document deletion job identifiers are invalid");
  }
  const objectKeys = job.payload.objectKeys;
  if (!Array.isArray(objectKeys) || objectKeys.length > 500 || objectKeys.some((key) => typeof key !== "string")) {
    throw new Error("Document deletion object list is invalid");
  }
  const privatePrefix = `private/${userId}/${resourceId}/`;
  const pendingPrefix = `pending/${userId}/${resourceId}/`;
  for (const key of objectKeys as string[]) {
    const pendingParts = key.startsWith(pendingPrefix) ? key.slice(pendingPrefix.length).split("/") : [];
    const isPendingKey = pendingParts.length === 2 && UUID.test(pendingParts[0] ?? "") && /^[0-9a-f-]{36}\.pdf$/i.test(pendingParts[1] ?? "");
    if (!key.startsWith(privatePrefix) && !isPendingKey) throw new Error("Document deletion contains an unauthorized object key");
    await deletePrivateObject(key);
  }
  return { resourceId, status: "deleted", objectCount: objectKeys.length };
}

export async function markUploadedPdfFailed(sql: SqlClient, job: DocumentJob): Promise<void> {
  const { userId, resourceId, versionId } = jobIds(job);
  await sql.begin(async (tx) => {
    const [resource] = await tx<{ metadata: JsonObject; deleted_at: Date | null; current_version_id: string | null; created_at: Date }[]>`
      SELECT metadata, deleted_at, current_version_id, created_at FROM catalog.resources
      WHERE id = ${resourceId} AND owner_user_id = ${userId} AND provider = 'user_upload' AND type = 'pdf'
      FOR UPDATE
    `;
    if (!resource || resource.deleted_at || resource.current_version_id === versionId) return;
    const upload = uploadMetadata(resource.metadata);
    if (!upload || upload.versionId !== versionId || upload.state !== "queued") return;
    const pendingPrefix = `pending/${userId}/${resourceId}/${versionId}/`;
    const pendingObjectKey = upload.pendingObjectKey.startsWith(pendingPrefix)
      && /^[0-9a-f-]{36}\.pdf$/i.test(upload.pendingObjectKey.slice(pendingPrefix.length))
      ? upload.pendingObjectKey
      : null;
    await tx`
      UPDATE catalog.resources
      SET status = 'failed', metadata = ${tx.json({
        ...(objectValue(resource.metadata) ?? {}),
        documentUpload: { ...upload, state: "failed" },
      })}, updated_at = now()
      WHERE id = ${resourceId} AND owner_user_id = ${userId}
    `;
    const availableAt = new Date(Math.max(Date.now(), resource.created_at.getTime() + PRIVATE_UPLOAD_DELETE_GRACE_SECONDS * 1000));
    await tx`
      INSERT INTO ops.outbox_events
        (aggregate_type, aggregate_id, event_type, schema_version, user_id, payload, trace_id, available_at)
      VALUES
        ('resource', ${resourceId}, 'resource.file_deletion_requested', 1, ${userId},
          ${tx.json({ resourceId, objectKeys: [privateDocumentKey(userId, resourceId, versionId), ...(pendingObjectKey ? [pendingObjectKey] : [])] })}, ${job.trace_id}, ${availableAt})
    `;
  });
}
