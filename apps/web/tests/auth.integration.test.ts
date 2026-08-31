import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { closeDb } from "@learnspace/db";
import {
  consumeEmailVerificationChallenge,
  createAuthChallenge,
  createEmailUser,
  createSession,
  findSessionByToken,
  findUserById,
  resetPasswordWithChallenge,
  revokeSessionByToken,
  upsertGoogleUser,
} from "../lib/auth/repository";
import { hashPassword, hashToken, verifyPassword } from "../lib/auth/crypto";

const databaseAvailable = Boolean(
  process.env.DATABASE_AUTH_URL && process.env.DATABASE_MIGRATOR_URL,
);

test(
  "auth repository protects verification, sessions, reset, and Google linking",
  { skip: databaseAvailable ? false : "DATABASE_AUTH_URL and DATABASE_MIGRATOR_URL are required" },
  async () => {
    const migratorUrl = process.env.DATABASE_MIGRATOR_URL;
    if (!migratorUrl) {
      throw new Error("DATABASE_MIGRATOR_URL is required for auth integration tests");
    }
    const migrator = postgres(migratorUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
    });
    const userIds: string[] = [];

    try {
      const email = `auth-${randomUUID()}@example.test`;
      const oldPassword = "old-password-123";
      const user = await createEmailUser({
        email,
        displayName: "Integration Learner",
        passwordHash: await hashPassword(oldPassword),
      });
      userIds.push(user.id);
      assert.equal(user.emailVerified, false);

      const accountRows = await migrator<{ provider: string }[]>`
        SELECT provider FROM identity.auth_accounts WHERE user_id = ${user.id}
      `;
      assert.deepEqual(accountRows.map((row) => row.provider), ["email"]);
      const settingsRows = await migrator<{ user_id: string }[]>`
        SELECT user_id FROM identity.user_settings WHERE user_id = ${user.id}
      `;
      assert.equal(settingsRows.length, 1);
      const duplicateHash = await hashPassword(oldPassword);
      await assert.rejects(() =>
        createEmailUser({
          email,
          displayName: "Duplicate",
          passwordHash: duplicateHash,
        }),
      );

      const verificationToken = await createAuthChallenge(
        user.id,
        "email_verification",
        new Date(Date.now() + 60_000),
      );
      const verificationRows = await migrator<{ token_hash: string }[]>`
        SELECT token_hash FROM identity.auth_challenges
        WHERE user_id = ${user.id} AND purpose = 'email_verification'
      `;
      assert.equal(verificationRows.length, 1);
      assert.notEqual(verificationRows[0]?.token_hash, verificationToken);
      assert.equal(verificationRows[0]?.token_hash, hashToken(verificationToken));
      const verified = await consumeEmailVerificationChallenge(verificationToken);
      assert.equal(verified?.user.emailVerified, true);
      assert.equal(await consumeEmailVerificationChallenge(verificationToken), null);

      const session = await createSession(user.id, { userAgent: "integration" }, "integration-secret");
      const secondSession = await createSession(user.id, {}, "integration-secret");
      assert.equal((await findSessionByToken(session.token))?.user.id, user.id);
      assert.equal(await findSessionByToken("fake-session-cookie"), null);
      await migrator`
        UPDATE identity.auth_sessions SET expires_at = now() - interval '1 minute'
        WHERE refresh_token_hash = ${hashToken(session.token)}
      `;
      assert.equal(await findSessionByToken(session.token), null);
      await revokeSessionByToken(session.token, "expired");
      assert.equal((await findSessionByToken(secondSession.token))?.user.id, user.id);
      await revokeSessionByToken(secondSession.token, "logout");
      assert.equal(await findSessionByToken(secondSession.token), null);

      const resetSession = await createSession(user.id, {}, "integration-secret");
      const resetToken = await createAuthChallenge(
        user.id,
        "password_reset",
        new Date(Date.now() + 60_000),
      );
      const newPassword = "new-password-456";
      assert.equal(await resetPasswordWithChallenge(resetToken, await hashPassword(newPassword)), true);
      assert.equal(await resetPasswordWithChallenge(resetToken, await hashPassword("replay")), false);
      const resetUser = await findUserById(user.id);
      assert.ok(resetUser?.passwordHash);
      assert.equal(await verifyPassword(oldPassword, resetUser.passwordHash), false);
      assert.equal(await verifyPassword(newPassword, resetUser.passwordHash), true);
      assert.equal(await findSessionByToken(resetSession.token), null);
      const resetReasonRows = await migrator<{ revocation_reason: string }[]>`
        SELECT revocation_reason FROM identity.auth_sessions
        WHERE user_id = ${user.id} AND revocation_reason = 'password_reset'
      `;
      assert.equal(resetReasonRows.length, 1);

      const expiredToken = await createAuthChallenge(
        user.id,
        "password_reset",
        new Date(Date.now() - 1),
      );
      assert.equal(await resetPasswordWithChallenge(expiredToken, await hashPassword("ignored")), false);
      assert.equal(await resetPasswordWithChallenge("malformed-token", await hashPassword("ignored")), false);

      const takeoverEmail = `takeover-${randomUUID()}@example.test`;
      const attackerPassword = "attacker-password-789";
      const attacker = await createEmailUser({
        email: takeoverEmail,
        displayName: "Attacker",
        passwordHash: await hashPassword(attackerPassword),
      });
      userIds.push(attacker.id);
      const linked = await upsertGoogleUser({
        providerAccountId: `google-${randomUUID()}`,
        email: takeoverEmail,
        displayName: "Verified Owner",
        profile: { sub: "regression" },
      });
      assert.equal(linked.id, attacker.id);
      assert.equal(linked.emailVerified, true);
      assert.equal(linked.passwordHash, null);
      assert.equal(await verifyPassword(attackerPassword, linked.passwordHash ?? ""), false);
      const linkedEmailAccount = await migrator<{ email_verified: boolean }[]>`
        SELECT email_verified FROM identity.auth_accounts
        WHERE user_id = ${attacker.id} AND provider = 'email'
      `;
      assert.equal(linkedEmailAccount[0]?.email_verified, true);

      const preservedEmail = `verified-${randomUUID()}@example.test`;
      const preservedPassword = "preserved-password-123";
      const verifiedUser = await createEmailUser({
        email: preservedEmail,
        displayName: "Verified Learner",
        passwordHash: await hashPassword(preservedPassword),
      });
      userIds.push(verifiedUser.id);
      const verifiedChallenge = await createAuthChallenge(
        verifiedUser.id,
        "email_verification",
        new Date(Date.now() + 60_000),
      );
      await consumeEmailVerificationChallenge(verifiedChallenge);
      const preserved = await upsertGoogleUser({
        providerAccountId: `google-${randomUUID()}`,
        email: preservedEmail,
        profile: { sub: "verified-link" },
      });
      assert.equal(await verifyPassword(preservedPassword, preserved.passwordHash ?? ""), true);

      const raceEmail = `race-${randomUUID()}@example.test`;
      const raceProvider = `google-race-${randomUUID()}`;
      const raceResults = await Promise.all([
        upsertGoogleUser({ providerAccountId: raceProvider, email: raceEmail, profile: { sub: raceProvider } }),
        upsertGoogleUser({ providerAccountId: raceProvider, email: raceEmail, profile: { sub: raceProvider } }),
      ]);
      userIds.push(raceResults[0].id);
      assert.equal(raceResults[0].id, raceResults[1].id);
      const raceAccounts = await migrator<{ count: string }[]>`
        SELECT count(*)::text AS count FROM identity.auth_accounts
        WHERE provider = 'google' AND provider_account_id = ${raceProvider}
      `;
      assert.equal(Number(raceAccounts[0]?.count), 1);
    } finally {
      for (const userId of userIds) {
        await migrator`DELETE FROM identity.users WHERE id = ${userId}`;
      }
      await migrator.end({ timeout: 5 });
      await closeDb();
    }
  },
);
