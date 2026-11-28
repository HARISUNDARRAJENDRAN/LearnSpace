import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { withUserTransaction } from "@learnspace/db";
import {
  outboxEvents,
  resources,
  sessionFolderResources as savedResources,
  sessionFolders as folders,
  sessionFolderShareImports as folderShareImports,
  sessionFolderShares as folderShares,
  userSettings,
} from "@learnspace/db/schema";
import { folderShareTokenSchema, type FolderShareState, type ImportSharedFolderResponse } from "@learnspace/shared";
import { and, eq, inArray, isNull, max, or, sql } from "drizzle-orm";
import { getAppBaseUrl, getAuthSecret } from "../auth/config";
import { createOpaqueToken, hashToken } from "../auth/crypto";
import { AuthError } from "../auth/errors";
import { invalidateHomeFeedCache } from "../discovery/cache";
import { ownedFolder } from "./service";

const SHARE_ENCRYPTION_SALT = Buffer.from("learnspace:folder-share", "utf8");
const SHARE_ENCRYPTION_INFO = Buffer.from("token-encryption-v1", "utf8");
const MAX_CLONED_MATERIALS = 200;

type ResolvedMaterial = {
  resourceId: string | null;
  visibility: "public" | "unlisted" | "private";
  type: "paper" | "pdf" | "video";
  provider: string;
  externalId: string | null;
  canonicalUrl: string | null;
  title: string;
  description: string | null;
  language: string | null;
  metadata: Record<string, unknown> | null;
};

type ResolvedSharedFolder = {
  shareId: string;
  folderId: string | null;
  isOwner: boolean;
  title: string;
  description: string | null;
  materials: ResolvedMaterial[];
};

function shareEncryptionKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), SHARE_ENCRYPTION_SALT, SHARE_ENCRYPTION_INFO, 32));
}

export function encryptShareToken(token: string, secret = getAuthSecret()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", shareEncryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptShareToken(ciphertext: string, secret = getAuthSecret()): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Invalid share token ciphertext format");
  }
  const [, ivPart = "", tagPart = "", bodyPart = ""] = parts;
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const body = Buffer.from(bodyPart, "base64url");
  if (iv.length !== 12 || tag.length !== 16 || body.length === 0) {
    throw new Error("Invalid share token ciphertext components");
  }
  const decipher = createDecipheriv("aes-256-gcm", shareEncryptionKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

export function isValidShareToken(token: string): boolean {
  return folderShareTokenSchema.safeParse(token).success;
}

export function assertSameOrigin(request: Request): void {
  const expectedOrigin = getAppBaseUrl(request);
  const origin = request.headers.get("origin");
  if (origin) {
    if (origin !== expectedOrigin) {
      throw new AuthError("INVALID_ORIGIN", "Cross-site requests are not allowed.", 403);
    }
    return;
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin !== expectedOrigin) {
        throw new AuthError("INVALID_ORIGIN", "Cross-site requests are not allowed.", 403);
      }
      return;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError("INVALID_ORIGIN", "Invalid request origin.", 403);
    }
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new AuthError("INVALID_ORIGIN", "Cross-site requests are not allowed.", 403);
  }
}

function shareUrlFromToken(baseUrl: string, token: string): string {
  return new URL(`/share/${token}`, baseUrl).toString();
}

function shareNotFound() {
  return new AuthError("SHARE_NOT_FOUND", "This share link is invalid or has been revoked.", 404);
}

function folderModeForMaterials(materials: Array<{ type: string }>): "learn" | "research" {
  let papers = 0;
  let videos = 0;
  for (const item of materials) {
    if (item.type === "video") videos += 1;
    else papers += 1;
  }
  return papers > 0 && papers >= videos ? "research" : "learn";
}

function folderDestination(folderId: string, mode: "learn" | "research"): string {
  return `/app/sessions/folders/${folderId}${mode === "research" ? "?mode=research" : ""}`;
}

function sanitizeClonedMetadata(metadata: Record<string, unknown> | null): Record<string, unknown> {
  const clean: Record<string, unknown> = { importedBy: "folder-share", ingestionStatus: "queued" };
  if (!metadata) return clean;
  for (const key of ["thumbnailUrl", "channelTitle", "venue", "pdfSourceUrl", "arxivId", "doi"] as const) {
    if (typeof metadata[key] === "string" && metadata[key].trim().length > 0) {
      clean[key] = metadata[key];
    }
  }
  if (typeof metadata.year === "number" && Number.isInteger(metadata.year)) {
    clean.year = metadata.year;
  }
  if (Array.isArray(metadata.authors)) {
    const authors = metadata.authors.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 50);
    if (authors.length > 0) clean.authors = authors;
  }
  return clean;
}

export function getFolderShare(userId: string, folderId: string, baseUrl: string): Promise<FolderShareState> {
  return withUserTransaction(userId, async (tx) => {
    await ownedFolder(tx, userId, folderId);
    const [active] = await tx
      .select({ tokenCiphertext: folderShares.tokenCiphertext, createdAt: folderShares.createdAt })
      .from(folderShares)
      .where(and(eq(folderShares.userId, userId), eq(folderShares.folderId, folderId), isNull(folderShares.revokedAt)))
      .limit(1);
    if (!active) {
      return { enabled: false, shareUrl: null, createdAt: null };
    }
    const token = decryptShareToken(active.tokenCiphertext);
    return {
      enabled: true,
      shareUrl: shareUrlFromToken(baseUrl, token),
      createdAt: active.createdAt.toISOString(),
    };
  });
}

export function createOrRotateFolderShare(
  userId: string,
  folderId: string,
  baseUrl: string,
  options: { rotate?: boolean } = {},
): Promise<FolderShareState> {
  return withUserTransaction(userId, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`study.folder-share:${userId}:${folderId}`}, 0))`);
    await ownedFolder(tx, userId, folderId);

    const [existing] = await tx
      .select({ id: folderShares.id, tokenCiphertext: folderShares.tokenCiphertext, createdAt: folderShares.createdAt })
      .from(folderShares)
      .where(and(eq(folderShares.userId, userId), eq(folderShares.folderId, folderId), isNull(folderShares.revokedAt)))
      .limit(1);

    if (existing && !options.rotate) {
      const token = decryptShareToken(existing.tokenCiphertext);
      return {
        enabled: true,
        shareUrl: shareUrlFromToken(baseUrl, token),
        createdAt: existing.createdAt.toISOString(),
      };
    }

    const now = new Date();
    if (existing) {
      await tx
        .update(folderShares)
        .set({ revokedAt: now, updatedAt: now })
        .where(and(eq(folderShares.userId, userId), eq(folderShares.id, existing.id), isNull(folderShares.revokedAt)));
    }

    const token = createOpaqueToken();
    const tokenHash = hashToken(token);
    const tokenCiphertext = encryptShareToken(token);
    const [created] = await tx
      .insert(folderShares)
      .values({ userId, folderId, tokenHash, tokenCiphertext, createdAt: now, updatedAt: now })
      .returning({ createdAt: folderShares.createdAt });

    return {
      enabled: true,
      shareUrl: shareUrlFromToken(baseUrl, token),
      createdAt: (created?.createdAt ?? now).toISOString(),
    };
  });
}

export function revokeFolderShare(userId: string, folderId: string): Promise<FolderShareState> {
  return withUserTransaction(userId, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`study.folder-share:${userId}:${folderId}`}, 0))`);
    await ownedFolder(tx, userId, folderId);
    const now = new Date();
    await tx
      .update(folderShares)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(folderShares.userId, userId), eq(folderShares.folderId, folderId), isNull(folderShares.revokedAt)));
    return { enabled: false, shareUrl: null, createdAt: null };
  });
}

export async function importSharedFolder(userId: string, token: string): Promise<ImportSharedFolderResponse> {
  if (!isValidShareToken(token)) {
    throw shareNotFound();
  }

  const tokenHash = hashToken(token);

  const result = await withUserTransaction(userId, async (tx) => {
    // Serialize folder creation and idempotent share import per recipient.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`study.folders:${userId}`}, 0))`);

    const resolvedRows = await tx.execute<{ shared: ResolvedSharedFolder | null }>(
      sql`SELECT study.resolve_shared_folder(${tokenHash}) AS shared`,
    );
    const shared = resolvedRows[0]?.shared ?? null;
    if (!shared) {
      throw shareNotFound();
    }

    const mode = folderModeForMaterials(shared.materials);

    // Owner opening their own share link lands in their original folder without cloning.
    if (shared.isOwner && shared.folderId) {
      return {
        folderId: shared.folderId,
        href: folderDestination(shared.folderId, mode),
        status: "owned" as const,
      };
    }

    // Ensure first-time recipients who finished onboarding aren't redirected away to Discover.
    await tx
      .update(userSettings)
      .set({ firstApplicationVisitAt: sql`COALESCE(${userSettings.firstApplicationVisitAt}, now())`, updatedAt: new Date() })
      .where(and(eq(userSettings.userId, userId), sql`${userSettings.onboardingCompletedAt} IS NOT NULL`));

    // Idempotency: if this recipient already imported this share (and still has the cloned folder), reopen it.
    const [existingImport] = await tx
      .select({ clonedFolderId: folderShareImports.clonedFolderId })
      .from(folderShareImports)
      .where(and(eq(folderShareImports.userId, userId), eq(folderShareImports.shareId, shared.shareId)))
      .limit(1);

    if (existingImport) {
      return {
        folderId: existingImport.clonedFolderId,
        href: folderDestination(existingImport.clonedFolderId, mode),
        status: "existing" as const,
      };
    }

    const [lastFolder] = await tx
      .select({ position: max(folders.position) })
      .from(folders)
      .where(eq(folders.userId, userId));

    const [clonedFolder] = await tx
      .insert(folders)
      .values({
        userId,
        title: shared.title.slice(0, 120),
        description: shared.description ? shared.description.slice(0, 1000) : null,
        position: (lastFolder?.position ?? -1) + 1,
      })
      .returning({ id: folders.id });

    if (!clonedFolder) {
      throw new Error("Shared folder could not be cloned");
    }

    const attachedResourceIds = new Set<string>();
    const correlationId = randomUUID();
    let position = 0;

    for (const item of shared.materials.slice(0, MAX_CLONED_MATERIALS)) {
      let targetResourceId: string | null = null;

      if ((item.visibility === "public" || item.visibility === "unlisted") && item.resourceId) {
        const [visible] = await tx
          .select({ id: resources.id })
          .from(resources)
          .where(and(
            eq(resources.id, item.resourceId),
            inArray(resources.visibility, ["public", "unlisted"]),
            inArray(resources.type, ["paper", "pdf", "video"]),
            isNull(resources.deletedAt),
          ))
          .limit(1);
        targetResourceId = visible?.id ?? null;
      }

      if (!targetResourceId && item.externalId) {
        const candidates = await tx
          .select({
            id: resources.id,
            visibility: resources.visibility,
            currentVersionId: resources.currentVersionId,
          })
          .from(resources)
          .where(and(
            eq(resources.provider, item.provider),
            eq(resources.externalId, item.externalId),
            or(eq(resources.ownerUserId, userId), inArray(resources.visibility, ["public", "unlisted"])),
            inArray(resources.type, ["paper", "pdf", "video"]),
            isNull(resources.deletedAt),
          ))
          .limit(5);

        const best = candidates.sort((a, b) => {
          const readyDiff = Number(Boolean(b.currentVersionId)) - Number(Boolean(a.currentVersionId));
          if (readyDiff !== 0) return readyDiff;
          return Number(b.visibility !== "private") - Number(a.visibility !== "private");
        })[0];

        if (best) {
          targetResourceId = best.id;
        }
      }

      if (!targetResourceId) {
        const [created] = await tx
          .insert(resources)
          .values({
            ownerUserId: userId,
            type: item.type,
            provider: item.provider,
            externalId: item.externalId,
            canonicalUrl: item.canonicalUrl,
            title: item.title,
            description: item.description,
            language: item.language,
            visibility: "private",
            status: "pending",
            metadata: sanitizeClonedMetadata(item.metadata),
          })
          .onConflictDoNothing()
          .returning({ id: resources.id });

        targetResourceId = created?.id ?? null;
        if (!targetResourceId && item.externalId) {
          const [ownedExisting] = await tx
            .select({ id: resources.id })
            .from(resources)
            .where(and(
              eq(resources.ownerUserId, userId),
              eq(resources.provider, item.provider),
              eq(resources.externalId, item.externalId),
              isNull(resources.deletedAt),
            ))
            .limit(1);
          targetResourceId = ownedExisting?.id ?? null;
        }

        if (created?.id && item.canonicalUrl && item.externalId) {
          await tx.insert(outboxEvents).values({
            aggregateType: "resource",
            aggregateId: created.id,
            eventType: "resource.ingestion_requested",
            schemaVersion: 1,
            userId,
            correlationId,
            payload: {
              resourceId: created.id,
              provider: item.provider,
              externalId: item.externalId,
              sourceUrl: item.canonicalUrl,
              sourceKind: item.type === "video" ? "video" : "paper",
              requestedBy: "folder-share",
            },
          });
        }
      }

      if (targetResourceId && !attachedResourceIds.has(targetResourceId)) {
        attachedResourceIds.add(targetResourceId);
        await tx
          .insert(savedResources)
          .values({ userId, folderId: clonedFolder.id, resourceId: targetResourceId, position })
          .onConflictDoNothing();
        position += 1;
      }
    }

    await tx.insert(folderShareImports).values({
      shareId: shared.shareId,
      userId,
      clonedFolderId: clonedFolder.id,
    });

    return {
      folderId: clonedFolder.id,
      href: folderDestination(clonedFolder.id, mode),
      status: "imported" as const,
    };
  });

  if (result.status === "imported") {
    await invalidateHomeFeedCache(userId);
  }

  return result;
}
