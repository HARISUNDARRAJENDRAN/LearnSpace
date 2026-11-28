import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { AuthError } from "../lib/auth/errors";

const dbAvailable = Boolean(
  process.env.DATABASE_MIGRATOR_URL &&
  process.env.DATABASE_URL &&
  process.env.DATABASE_AUTH_URL,
);

const status = (expected: number) => (error: unknown) =>
  error instanceof AuthError && error.status === expected;

test(
  "folder sharing enforces RLS, clones public and private materials safely, preserves onboarding redirect, and supports rotation and revocation",
  { skip: !dbAvailable },
  async () => {
    const previousAuthSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || "integration-test-auth-secret-32-plus-chars";

    const [
      { closeDb },
      { createEmailUser },
      folders,
      { getSessionFolderDetails },
      share,
      study,
      onboarding,
    ] = await Promise.all([
      import("@learnspace/db"),
      import("../lib/auth/repository"),
      import("../lib/folders/service"),
      import("../lib/folders/details"),
      import("../lib/folders/share"),
      import("../lib/study/service"),
      import("../lib/onboarding/service"),
    ]);

    const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
    const appUrl = process.env.DATABASE_URL;
    assert.ok(migratorUrl && appUrl);
    const db = postgres(migratorUrl, { max: 1, prepare: false });
    const app = postgres(appUrl, { max: 1, prepare: false });
    const { id: owner } = await createEmailUser({
      email: `share-owner-${randomUUID()}@example.test`,
      displayName: "Share Owner",
      passwordHash: "test-hash",
    });
    const { id: recipient } = await createEmailUser({
      email: `share-recipient-${randomUUID()}@example.test`,
      displayName: "Share Recipient",
      passwordHash: "test-hash",
    });
    const { id: newcomer } = await createEmailUser({
      email: `share-newcomer-${randomUUID()}@example.test`,
      displayName: "Share Newcomer",
      passwordHash: "test-hash",
    });
    const userIds = [owner, recipient, newcomer];
    const publicPaperId = randomUUID();
    const privatePaperId = randomUUID();
    const publicVideoId = randomUUID();
    const createdResourceIds: string[] = [publicPaperId, privatePaperId, publicVideoId];

    try {
      const youtubeId = `s${publicVideoId.replaceAll("-", "").slice(0, 10)}`;
      const privateArxivId = `2401.${Math.floor(10000 + Math.random() * 89999)}`;
      await db`
        INSERT INTO catalog.resources (id, owner_user_id, type, provider, external_id, canonical_url, title, description, visibility, status, metadata)
        VALUES
          (${publicPaperId}, NULL, 'paper', 'arxiv', ${`pub-${publicPaperId.slice(0, 8)}`}, 'https://arxiv.org/abs/2301.00001', 'Public Paper', 'Public abstract', 'public', 'ready', '{"authors":["Alice"],"year":2024,"secretOwnerNote":"should-not-matter"}'::jsonb),
          (${privatePaperId}, ${owner}, 'paper', 'arxiv', ${privateArxivId}, ${`https://arxiv.org/abs/${privateArxivId}`}, 'Private Imported Paper', 'Private abstract', 'private', 'pending', '{"authors":["Bob"],"venue":"NeurIPS","year":2025,"privateField":"DO_NOT_LEAK"}'::jsonb),
          (${publicVideoId}, NULL, 'video', 'youtube', ${youtubeId}, ${`https://www.youtube.com/watch?v=${youtubeId}`}, 'Shared Video Lecture', NULL, 'public', 'ready', '{}'::jsonb)
      `;
      await db`INSERT INTO catalog.paper_details (resource_id, arxiv_id, venue) VALUES (${publicPaperId}, ${`pub-${publicPaperId.slice(0, 8)}`}, 'ICML')`;
      await db`INSERT INTO catalog.video_details (resource_id, youtube_id, duration_ms) VALUES (${publicVideoId}, ${youtubeId}, 180000)`;

      // Complete onboarding for owner and recipient; keep newcomer un-onboarded initially.
      const concepts = await db<{ id: string }[]>`SELECT id FROM knowledge.concepts LIMIT 3`;
      assert.equal(concepts.length, 3);
      const conceptIds = concepts.map((row) => row.id);
      const completion = {
        persona: "researcher" as const,
        learningIntents: ["read_papers"],
        preferredFormats: ["research_backed" as const],
        preferredDuration: "ten_to_thirty_minutes" as const,
        selfReportedLevel: "intermediate" as const,
        conceptIds,
      };
      await onboarding.completeOnboarding(owner, completion);
      await onboarding.completeOnboarding(recipient, completion);

      // Owner builds a folder containing a folder-filed session + saved public paper + saved private paper.
      const folder = await folders.createSessionFolder(owner, {
        title: "RL Generalization Reading List",
        description: "Ordered papers & video for our project.",
      });
      await folders.changeSessionFolder(owner, folder.id, { action: "save-resource", resourceId: publicPaperId });
      await folders.changeSessionFolder(owner, folder.id, { action: "save-resource", resourceId: privatePaperId });
      await folders.changeSessionFolder(owner, folder.id, { action: "save-resource", resourceId: publicVideoId });
      await folders.changeSessionFolder(owner, folder.id, {
        action: "start-resource",
        resourceId: publicVideoId,
        idempotencyKey: randomUUID(),
      });

      const baseUrl = "https://learn-space.app";
      assert.deepEqual(await share.getFolderShare(owner, folder.id, baseUrl), {
        enabled: false,
        shareUrl: null,
        createdAt: null,
      });

      // Non-owner cannot inspect, create, or revoke another user's folder share.
      await assert.rejects(share.getFolderShare(recipient, folder.id, baseUrl), status(404));
      await assert.rejects(share.createOrRotateFolderShare(recipient, folder.id, baseUrl), status(404));
      await assert.rejects(share.revokeFolderShare(recipient, folder.id), status(404));

      // Owner enables share link (idempotent when rotate=false).
      const created = await share.createOrRotateFolderShare(owner, folder.id, baseUrl);
      assert.equal(created.enabled, true);
      assert.ok(created.shareUrl?.startsWith(`${baseUrl}/share/`));
      const token = created.shareUrl?.split("/share/")[1];
      assert.ok(token);
      assert.equal(share.isValidShareToken(token), true);

      const repeat = await share.createOrRotateFolderShare(owner, folder.id, baseUrl, { rotate: false });
      assert.equal(repeat.shareUrl, created.shareUrl);

      // Verify DB never stores plaintext token and RLS isolates share rows from recipients.
      const storedRows = await db<{ token_hash: string; token_ciphertext: string }[]>`
        SELECT token_hash, token_ciphertext FROM study.session_folder_shares WHERE folder_id = ${folder.id}
      `;
      assert.equal(storedRows.length, 1);
      assert.notEqual(storedRows[0]?.token_hash, token);
      assert.equal(storedRows[0]?.token_ciphertext.includes(token), false);

      const recipientVisibleShares = await app.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${recipient}, true)`;
        return tx`SELECT id FROM study.session_folder_shares WHERE folder_id = ${folder.id}`;
      });
      assert.equal(recipientVisibleShares.length, 0);

      // Owner opening their own link opens the original folder without cloning.
      const selfOpen = await share.importSharedFolder(owner, token);
      assert.equal(selfOpen.status, "owned");
      assert.equal(selfOpen.folderId, folder.id);
      assert.equal((await folders.listSessionFolders(owner)).length, 1);

      // Recipient imports the shared folder into an isolated clone.
      const imported = await share.importSharedFolder(recipient, token);
      assert.equal(imported.status, "imported");
      assert.notEqual(imported.folderId, folder.id);
      assert.equal(imported.href, `/app/sessions/folders/${imported.folderId}?mode=research`);

      const clonedDetails = await getSessionFolderDetails(recipient, imported.folderId);
      assert.equal(clonedDetails.title, "RL Generalization Reading List");
      assert.equal(clonedDetails.description, "Ordered papers & video for our project.");
      assert.equal(clonedDetails.materials.length, 3);
      assert.deepEqual(
        clonedDetails.materials.map((item) => item.title),
        ["Shared Video Lecture", "Public Paper", "Private Imported Paper"],
      );
      // Public resources are reused directly; owner's private resource is cloned into recipient's own private copy without leaking private metadata.
      assert.equal(clonedDetails.materials[0]?.id, publicVideoId);
      assert.equal(clonedDetails.materials[1]?.id, publicPaperId);
      const clonedPrivateId = clonedDetails.materials[2]?.id;
      assert.ok(clonedPrivateId);
      assert.notEqual(clonedPrivateId, privatePaperId);
      createdResourceIds.push(clonedPrivateId);

      const [clonedPrivateRow] = await db<{ owner_user_id: string | null; visibility: string; metadata: Record<string, unknown> }[]>`
        SELECT owner_user_id, visibility, metadata FROM catalog.resources WHERE id = ${clonedPrivateId}
      `;
      assert.equal(clonedPrivateRow?.owner_user_id, recipient);
      assert.equal(clonedPrivateRow?.visibility, "private");
      assert.equal(clonedPrivateRow?.metadata.venue, "NeurIPS");
      assert.equal("privateField" in (clonedPrivateRow?.metadata ?? {}), false);
      // Owner's active sessions are never shared into recipient's account.
      assert.equal((await study.listStudySessions(recipient)).length, 0);

      // Idempotent re-import returns the existing cloned folder without creating duplicates.
      const reimported = await share.importSharedFolder(recipient, token);
      assert.equal(reimported.status, "existing");
      assert.equal(reimported.folderId, imported.folderId);
      assert.equal((await folders.listSessionFolders(recipient)).length, 1);

      // Deleting the cloned folder cascades the import record so clicking the link again clones cleanly.
      await folders.deleteSessionFolder(recipient, imported.folderId);
      const clonedAgain = await share.importSharedFolder(recipient, token);
      assert.equal(clonedAgain.status, "imported");
      assert.notEqual(clonedAgain.folderId, imported.folderId);

      // Newcomer (not onboarded yet) gets routed to onboarding with next preserved, then lands directly on /share/<token> after onboarding!
      const sharePath = `/share/${token}`;
      assert.equal(
        await onboarding.getAuthenticatedDestination(newcomer, sharePath),
        `/onboarding?next=${encodeURIComponent(sharePath)}`,
      );
      await onboarding.completeOnboarding(newcomer, completion);
      assert.equal(await onboarding.getAuthenticatedDestination(newcomer, sharePath), sharePath);
      const newcomerImported = await share.importSharedFolder(newcomer, token);
      assert.equal(newcomerImported.status, "imported");
      const newcomerDetails = await getSessionFolderDetails(newcomer, newcomerImported.folderId);
      assert.equal(newcomerDetails.materials.length, 3);
      const newcomerPrivateId = newcomerDetails.materials[2]?.id;
      if (newcomerPrivateId) createdResourceIds.push(newcomerPrivateId);

      // Rotating invalidates the old link immediately and mints a working new link.
      const rotated = await share.createOrRotateFolderShare(owner, folder.id, baseUrl, { rotate: true });
      assert.equal(rotated.enabled, true);
      assert.notEqual(rotated.shareUrl, created.shareUrl);
      const rotatedToken = rotated.shareUrl?.split("/share/")[1];
      assert.ok(rotatedToken);
      await assert.rejects(share.importSharedFolder(recipient, token), status(404));
      const viaRotated = await share.importSharedFolder(recipient, rotatedToken);
      assert.equal(viaRotated.status, "imported");

      // Revoking invalidates the link immediately.
      const revoked = await share.revokeFolderShare(owner, folder.id);
      assert.equal(revoked.enabled, false);
      assert.equal(revoked.shareUrl, null);
      await assert.rejects(share.importSharedFolder(recipient, rotatedToken), status(404));
    } finally {
      try {
        await db`DELETE FROM study.session_folders WHERE user_id = ANY(${userIds}::uuid[])`;
        await db`DELETE FROM ops.outbox_events WHERE user_id = ANY(${userIds}::uuid[])`;
        await db`DELETE FROM ops.idempotency_records WHERE user_id = ANY(${userIds}::uuid[])`;
        await db`DELETE FROM activity.activity_events WHERE user_id = ANY(${userIds}::uuid[])`;
        await db`DELETE FROM study.session_checkpoints WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ANY(${userIds}::uuid[]))`;
        await db`DELETE FROM study.user_resource_progress WHERE user_id = ANY(${userIds}::uuid[])`;
        await db`DELETE FROM study.session_resources WHERE study_session_id IN (SELECT id FROM study.study_sessions WHERE user_id = ANY(${userIds}::uuid[]))`;
        await db`DELETE FROM study.study_sessions WHERE user_id = ANY(${userIds}::uuid[])`;
        await db`DELETE FROM catalog.video_details WHERE resource_id = ANY(${createdResourceIds}::uuid[])`;
        await db`DELETE FROM catalog.paper_details WHERE resource_id = ANY(${createdResourceIds}::uuid[])`;
        await db`DELETE FROM catalog.resources WHERE id = ANY(${createdResourceIds}::uuid[]) OR owner_user_id = ANY(${userIds}::uuid[])`;
        await db`DELETE FROM identity.users WHERE id = ANY(${userIds}::uuid[])`;
      } finally {
        await Promise.all([db.end({ timeout: 5 }), app.end({ timeout: 5 }), closeDb()]);
        if (previousAuthSecret === undefined) delete process.env.AUTH_SECRET;
        else process.env.AUTH_SECRET = previousAuthSecret;
      }
    }
  },
);
