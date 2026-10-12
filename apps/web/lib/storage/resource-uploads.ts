import { randomUUID } from "node:crypto";
import { withUserTransaction } from "@learnspace/db";
import { libraryItems, outboxEvents, resourceAssets, resourceVersions, resources } from "@learnspace/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { AuthError } from "../auth/errors";
import {
  headPrivateObject,
  MAX_PRIVATE_DOCUMENT_BYTES,
  PRIVATE_UPLOAD_DELETE_GRACE_SECONDS,
  pendingDocumentKey,
  privateDocumentKey,
  signPrivateDownload,
  signPrivateUpload,
} from "@learnspace/shared/private-storage";

type DocumentUpload = {
  versionId: string;
  pendingObjectKey: string;
  fileName: string;
  mimeType: "application/pdf";
  byteSize: number;
  state: "uploading" | "queued" | "ready" | "deleting";
};

function uploadMetadata(metadata: Record<string, unknown>): DocumentUpload | null {
  const value = metadata.documentUpload;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const upload = value as Record<string, unknown>;
  if (
    typeof upload.versionId !== "string"
    || typeof upload.pendingObjectKey !== "string"
    || typeof upload.fileName !== "string"
    || upload.mimeType !== "application/pdf"
    || typeof upload.byteSize !== "number"
    || !["uploading", "queued", "ready", "deleting"].includes(String(upload.state))
  ) return null;
  return upload as DocumentUpload;
}

function cleanUserText(value: string, replacePathSeparators = false) {
  return Array.from(value.normalize("NFKC"), (character) => {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return "";
    if (replacePathSeparators && (character === "/" || character === "\\")) return "_";
    return character;
  }).join("").trim();
}

export async function createDocumentUpload(userId: string, input: { title: string; fileName: string; byteSize: number }) {
  const fileName = cleanUserText(input.fileName, true);
  const title = cleanUserText(input.title);
  if (!fileName || fileName.length > 180 || !/\.pdf$/i.test(fileName)) {
    throw new AuthError("INVALID_DOCUMENT", "Upload a PDF file with a .pdf filename.", 422);
  }
  if (!title || title.length > 200) throw new AuthError("INVALID_TITLE", "Enter a title up to 200 characters.", 422);
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > MAX_PRIVATE_DOCUMENT_BYTES) {
    throw new AuthError("INVALID_DOCUMENT_SIZE", "PDF files must be 25 MB or smaller.", 422);
  }

  const resourceId = randomUUID();
  const versionId = randomUUID();
  const pendingObjectKey = pendingDocumentKey(userId, resourceId, versionId, randomUUID());
  const signedUpload = await signPrivateUpload(pendingObjectKey, input.byteSize);
  const now = new Date();

  await withUserTransaction(userId, async (tx) => {
    await tx.insert(resources).values({
      id: resourceId,
      ownerUserId: userId,
      type: "pdf",
      provider: "user_upload",
      title,
      visibility: "private",
      status: "pending",
      metadata: {
        documentUpload: {
          versionId,
          pendingObjectKey,
          fileName,
          mimeType: "application/pdf",
          byteSize: input.byteSize,
          state: "uploading",
        },
      },
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(libraryItems).values({ userId, resourceId, status: "saved", source: "user", addedAt: now, updatedAt: now });
  });

  return {
    resourceId,
    versionId,
    uploadUrl: signedUpload.url,
    headers: signedUpload.headers,
  };
}

export async function completeDocumentUpload(userId: string, resourceId: string, versionId: string) {
  const resource = await withUserTransaction(userId, async (tx) => {
    const [row] = await tx.select().from(resources).where(and(
      eq(resources.id, resourceId),
      eq(resources.ownerUserId, userId),
      isNull(resources.deletedAt),
    )).limit(1);
    return row ?? null;
  });
  if (resource?.provider !== "user_upload") throw new AuthError("RESOURCE_NOT_FOUND", "That upload is not available.", 404);
  const upload = uploadMetadata(resource.metadata);
  if (!upload || upload.versionId !== versionId) throw new AuthError("UPLOAD_NOT_FOUND", "That upload is not available.", 404);
  if (upload.state !== "uploading") return { resourceId, status: resource.status };

  const head = await headPrivateObject(upload.pendingObjectKey);
  if (head.ContentLength !== upload.byteSize || head.ContentType !== upload.mimeType) {
    throw new AuthError("UPLOAD_VALIDATION_FAILED", "The uploaded PDF did not match its declared size and type.", 422);
  }

  const correlationId = randomUUID();
  return withUserTransaction(userId, async (tx) => {
    await tx.execute(sql`SELECT id FROM catalog.resources WHERE id = ${resourceId} AND owner_user_id = ${userId} AND deleted_at IS NULL FOR UPDATE`);
    const [current] = await tx.select().from(resources).where(and(
      eq(resources.id, resourceId),
      eq(resources.ownerUserId, userId),
      isNull(resources.deletedAt),
    )).limit(1);
    if (!current) throw new AuthError("RESOURCE_NOT_FOUND", "That upload is not available.", 404);
    const currentUpload = uploadMetadata(current.metadata);
    if (!currentUpload || currentUpload.versionId !== versionId) throw new AuthError("UPLOAD_NOT_FOUND", "That upload is not available.", 404);
    if (currentUpload.state !== "uploading") return { resourceId, status: current.status };
    const queuedUpload = { ...currentUpload, state: "queued" as const };
    await tx.update(resources).set({ status: "processing", metadata: { ...current.metadata, documentUpload: queuedUpload }, updatedAt: new Date() }).where(eq(resources.id, resourceId));
    await tx.insert(outboxEvents).values({
      aggregateType: "resource",
      aggregateId: resourceId,
      eventType: "resource.ingestion_requested",
      schemaVersion: 1,
      userId,
      correlationId,
      payload: {
        resourceId,
        versionId,
        objectKey: currentUpload.pendingObjectKey,
        fileName: currentUpload.fileName,
        mimeType: currentUpload.mimeType,
        byteSize: currentUpload.byteSize,
        sourceKind: "uploaded_document",
      },
    });
    return { resourceId, status: "processing" };
  });
}

export async function getDocumentDownload(userId: string, resourceId: string) {
  const row = await withUserTransaction(userId, async (tx) => {
    const [result] = await tx.select({ resource: resources, version: resourceVersions }).from(resources)
      .innerJoin(resourceVersions, eq(resourceVersions.id, resources.currentVersionId))
      .where(and(
        eq(resources.id, resourceId),
        eq(resources.ownerUserId, userId),
        eq(resources.provider, "user_upload"),
        eq(resourceVersions.processingStatus, "ready"),
        isNull(resources.deletedAt),
      )).limit(1);
    return result ?? null;
  });
  if (!row) throw new AuthError("RESOURCE_NOT_FOUND", "That document is not ready or is unavailable.", 404);
  return signPrivateDownload(row.version.rawObjectKey);
}

export async function deleteDocument(userId: string, resourceId: string) {
  return withUserTransaction(userId, async (tx) => {
    await tx.execute(sql`SELECT id FROM catalog.resources WHERE id = ${resourceId} AND owner_user_id = ${userId} AND provider = 'user_upload' AND deleted_at IS NULL FOR UPDATE`);
    const [resource] = await tx.select().from(resources).where(and(
      eq(resources.id, resourceId),
      eq(resources.ownerUserId, userId),
      eq(resources.provider, "user_upload"),
      isNull(resources.deletedAt),
    )).limit(1);
    if (!resource) throw new AuthError("RESOURCE_NOT_FOUND", "That document is not available.", 404);

    const versions = await tx.select({ rawObjectKey: resourceVersions.rawObjectKey, normalizedObjectKey: resourceVersions.normalizedObjectKey })
      .from(resourceVersions).where(eq(resourceVersions.resourceId, resourceId));
    const assets = await tx.select({ objectKey: resourceAssets.objectKey }).from(resourceAssets)
      .innerJoin(resourceVersions, eq(resourceVersions.id, resourceAssets.resourceVersionId))
      .where(eq(resourceVersions.resourceId, resourceId));
    const upload = uploadMetadata(resource.metadata);
    const pendingPrefix = upload?.versionId ? `pending/${userId}/${resourceId}/${upload.versionId}/` : "";
    const pendingObjectKey = upload?.pendingObjectKey.startsWith(pendingPrefix)
      && /^[0-9a-f-]{36}\.pdf$/i.test(upload.pendingObjectKey.slice(pendingPrefix.length))
      ? upload.pendingObjectKey
      : null;
    const objectKeys = [...new Set([
      ...(pendingObjectKey ? [pendingObjectKey] : []),
      ...(upload?.versionId ? [privateDocumentKey(userId, resourceId, upload.versionId)] : []),
      ...versions.flatMap((version) => [version.rawObjectKey, version.normalizedObjectKey].filter((key): key is string => Boolean(key))),
      ...assets.map((asset) => asset.objectKey),
    ])];

    await tx.update(resources).set({ status: "archived", deletedAt: new Date(), updatedAt: new Date() }).where(eq(resources.id, resourceId));
    await tx.insert(outboxEvents).values({
      aggregateType: "resource",
      aggregateId: resourceId,
      eventType: "resource.file_deletion_requested",
      schemaVersion: 1,
      userId,
      correlationId: randomUUID(),
      payload: { resourceId, objectKeys },
      availableAt: pendingObjectKey
        ? new Date(Math.max(Date.now(), resource.createdAt.getTime() + PRIVATE_UPLOAD_DELETE_GRACE_SECONDS * 1000))
        : new Date(),
    });
    return { ok: true };
  });
}
