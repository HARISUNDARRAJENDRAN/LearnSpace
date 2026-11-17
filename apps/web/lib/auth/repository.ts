import {
  authAccounts,
  authChallenges,
  authSessions,
  userSettings,
  users,
} from "@learnspace/db/schema";
import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  createOpaqueToken,
  hashIpAddress,
  hashToken,
} from "./crypto";

const sessionLifetimeSeconds = 60 * 60 * 24 * 30;

async function getAuthDatabase() {
  const { getAuthDatabase } = await import("@learnspace/db");
  return getAuthDatabase();
}

export type UserRecord = typeof users.$inferSelect;

export type SessionContext = {
  userAgent?: string;
  ipAddress?: string;
};

export type PublicUser = Pick<
  UserRecord,
  "id" | "email" | "emailVerified" | "displayName" | "avatarUrl" | "subscriptionTier"
>;

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const database = await getAuthDatabase();
  const normalizedEmail = email.trim().toLowerCase();
  const rows = await database
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`)
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserById(userId: string): Promise<UserRecord | null> {
  const database = await getAuthDatabase();
  const rows = await database.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

export async function createEmailUser(input: {
  email: string;
  displayName: string;
  passwordHash: string;
}): Promise<UserRecord> {
  const userId = randomUUID();
  const database = await getAuthDatabase();

  await database.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      email: input.email,
      emailVerified: false,
      passwordHash: input.passwordHash,
      status: "active",
      displayName: input.displayName,
      locale: "en",
      timezone: "UTC",
      subscriptionTier: "free",
    });
    await tx.insert(authAccounts).values({
      userId,
      provider: "email",
      providerAccountId: input.email,
      providerEmail: input.email,
      emailVerified: false,
      profile: {},
    });
    await tx.execute(sql`INSERT INTO identity.user_settings (user_id) VALUES (${userId})`);
  });

  const user = await findUserById(userId);
  if (!user) {
    throw new Error("Created user could not be loaded");
  }
  return user;
}

export async function upsertGoogleUser(input: {
  providerAccountId: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  profile: Record<string, unknown>;
}): Promise<UserRecord> {
  const database = await getAuthDatabase();
  const email = input.email.trim().toLowerCase();
  const providerLock = `learnspace:google-account:${input.providerAccountId}`;
  const emailLock = `learnspace:google-email:${email}`;

  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${providerLock}))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${emailLock}))`);

    const accountRows = await tx
      .select({ id: authAccounts.id, userId: authAccounts.userId })
      .from(authAccounts)
      .where(
        and(
          eq(authAccounts.provider, "google"),
          eq(authAccounts.providerAccountId, input.providerAccountId),
        ),
      )
      .limit(1);
    const existingAccount = accountRows[0];
    let user: UserRecord | null = null;

    if (existingAccount) {
      const userRows = await tx.select().from(users).where(eq(users.id, existingAccount.userId)).limit(1);
      user = userRows[0] ?? null;
      if (!user) {
        throw new Error("Google account is linked to a missing user");
      }
    } else {
      const userRows = await tx
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);
      user = userRows[0] ?? null;
    }

    const userId = user?.id ?? randomUUID();
    if (!user) {
      await tx.insert(users).values({
        id: userId,
        email,
        emailVerified: true,
        passwordHash: null,
        status: "active",
        displayName: input.displayName ?? email.split("@")[0],
        avatarUrl: input.avatarUrl ?? null,
        locale: "en",
        timezone: "UTC",
        subscriptionTier: "free",
      });
      await tx.execute(sql`INSERT INTO identity.user_settings (user_id) VALUES (${userId})`);
    }

    const now = new Date();
    const invalidatePassword = Boolean(user && !user.emailVerified && user.passwordHash);
    await tx
      .update(users)
      .set({
        emailVerified: true,
        ...(invalidatePassword ? { passwordHash: null } : {}),
        displayName: input.displayName ?? user?.displayName ?? email.split("@")[0],
        avatarUrl: input.avatarUrl ?? user?.avatarUrl ?? null,
        updatedAt: now,
      })
      .where(eq(users.id, userId));

    if (invalidatePassword) {
      await tx
        .update(authAccounts)
        .set({ emailVerified: true, updatedAt: now })
        .where(
          and(
            eq(authAccounts.userId, userId),
            eq(authAccounts.provider, "email"),
          ),
        );
    }

    if (existingAccount) {
      await tx
        .update(authAccounts)
        .set({
          providerEmail: email,
          emailVerified: true,
          profile: input.profile,
          updatedAt: now,
        })
        .where(eq(authAccounts.id, existingAccount.id));
    } else {
      await tx.insert(authAccounts).values({
        userId,
        provider: "google",
        providerAccountId: input.providerAccountId,
        providerEmail: email,
        emailVerified: true,
        profile: input.profile,
      });
    }

    const updatedRows = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    const updatedUser = updatedRows[0];
    if (!updatedUser) {
      throw new Error("Google user could not be loaded");
    }
    return updatedUser;
  });
}

export type AuthChallengePurpose = "email_verification" | "password_reset";

export async function createAuthChallenge(
  userId: string,
  purpose: AuthChallengePurpose,
  expiresAt: Date,
): Promise<string> {
  const database = await getAuthDatabase();
  const token = createOpaqueToken();
  const now = new Date();

  await database.transaction(async (tx) => {
    const lockKey = `learnspace:auth-challenge:${userId}:${purpose}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    await tx
      .update(authChallenges)
      .set({ supersededAt: now })
      .where(
        and(
          eq(authChallenges.userId, userId),
          eq(authChallenges.purpose, purpose),
          isNull(authChallenges.consumedAt),
          isNull(authChallenges.supersededAt),
        ),
      );
    await tx.insert(authChallenges).values({
      userId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt,
    });
  });

  return token;
}

export async function consumeEmailVerificationChallenge(
  token: string,
): Promise<{ user: UserRecord; alreadyVerified: boolean } | null> {
  const database = await getAuthDatabase();
  const now = new Date();

  return database.transaction(async (tx) => {
    const challengeRows = await tx
      .update(authChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(authChallenges.tokenHash, hashToken(token)),
          eq(authChallenges.purpose, "email_verification"),
          isNull(authChallenges.consumedAt),
          isNull(authChallenges.supersededAt),
          gt(authChallenges.expiresAt, now),
        ),
      )
      .returning({ userId: authChallenges.userId });
    const challenge = challengeRows[0];
    if (!challenge) {
      return null;
    }

    const userRows = await tx.select().from(users).where(eq(users.id, challenge.userId)).limit(1);
    const user = userRows[0];
    if (!user) {
      return null;
    }

    await tx
      .update(users)
      .set({ emailVerified: true, updatedAt: now })
      .where(eq(users.id, user.id));
    await tx
      .update(authAccounts)
      .set({ emailVerified: true, updatedAt: now })
      .where(
        and(
          eq(authAccounts.userId, user.id),
          eq(authAccounts.provider, "email"),
        ),
      );
    const verifiedRows = await tx.select().from(users).where(eq(users.id, user.id)).limit(1);
    const verifiedUser = verifiedRows[0];
    if (!verifiedUser) {
      return null;
    }
    return { user: verifiedUser, alreadyVerified: user.emailVerified };
  });
}

export async function resetPasswordWithChallenge(
  token: string,
  passwordHash: string,
): Promise<boolean> {
  const database = await getAuthDatabase();
  const now = new Date();

  return database.transaction(async (tx) => {
    const challengeRows = await tx
      .update(authChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(authChallenges.tokenHash, hashToken(token)),
          eq(authChallenges.purpose, "password_reset"),
          isNull(authChallenges.consumedAt),
          isNull(authChallenges.supersededAt),
          gt(authChallenges.expiresAt, now),
        ),
      )
      .returning({ userId: authChallenges.userId });
    const challenge = challengeRows[0];
    if (!challenge) {
      return false;
    }

    await tx
      .update(users)
      .set({ passwordHash, updatedAt: now })
      .where(eq(users.id, challenge.userId));
    await tx
      .update(authSessions)
      .set({ revokedAt: now, revocationReason: "password_reset" })
      .where(
        and(
          eq(authSessions.userId, challenge.userId),
          isNull(authSessions.revokedAt),
        ),
      );
    return true;
  });
}

export async function createSession(
  userId: string,
  context: SessionContext,
  secret: string,
): Promise<{ token: string; maxAge: number }> {
  const token = createOpaqueToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionLifetimeSeconds * 1000);
  const database = await getAuthDatabase();

  await database.insert(authSessions).values({
    userId,
    rotationFamilyId: randomUUID(),
    refreshTokenHash: hashToken(token),
    userAgent: context.userAgent ?? null,
    ipHash: context.ipAddress ? hashIpAddress(context.ipAddress, secret) : null,
    lastSeenAt: now,
    expiresAt,
  });

  return { token, maxAge: sessionLifetimeSeconds };
}

export type SessionLookup = {
  session: typeof authSessions.$inferSelect;
  user: UserRecord;
  /** The learner's settings row, null if there is none; `completedAt` is when they finished onboarding. */
  onboarding: { completedAt: Date | null } | null;
};

/**
 * The live session behind a cookie, its user, and whether they finished onboarding, in one statement. Every request
 * starts here, so it is one round trip rather than one per table (and a separate transaction for the onboarding check).
 * The token's hash and the time go in as literals, a hex digest and an ISO timestamp that can only be themselves, so the
 * statement is sent as a simple query: one round trip, where a bound one takes two.
 */
export async function findSessionWithOnboarding(token: string): Promise<SessionLookup | null> {
  const database = await getAuthDatabase();
  const hash = hashToken(token);
  const now = new Date();
  const rows = await database
    .select({ session: authSessions, user: users, settingsUserId: userSettings.userId, onboardingCompletedAt: userSettings.onboardingCompletedAt })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .leftJoin(userSettings, eq(userSettings.userId, authSessions.userId))
    .where(
      and(
        sql`${authSessions.refreshTokenHash} = ${sql.raw(`'${hash}'`)}`,
        isNull(authSessions.revokedAt),
        sql`${authSessions.expiresAt} > ${sql.raw(`'${now.toISOString()}'::timestamptz`)}`,
      ),
    );
  // No LIMIT: drizzle would bind it, and a bound statement takes two round trips. A token is 256 random bits, so its
  // hash names one session at most.
  const row = rows[0];
  if (row?.user.status !== "active") {
    return null;
  }
  const { session, user } = row;

  // Seen at most every five minutes. A session seen in the last four is not asked about (a minute's margin for the
  // database's clock, which the statement itself still checks against). It is bookkeeping: a row another request has
  // locked is skipped rather than waited on, so the bump never delays or fails the request.
  if (session.lastSeenAt === null || session.lastSeenAt.getTime() < now.getTime() - 4 * 60_000) {
    const unlocked = database.select({ id: authSessions.id }).from(authSessions).where(eq(authSessions.id, session.id)).for("no key update", { skipLocked: true });
    await database
      .update(authSessions)
      .set({ lastSeenAt: new Date() })
      .where(
        and(
          inArray(authSessions.id, unlocked),
          or(
            isNull(authSessions.lastSeenAt),
            lt(authSessions.lastSeenAt, sql`now() - interval '5 minutes'`),
          ),
        ),
      );
  }

  return { session, user, onboarding: row.settingsUserId === null ? null : { completedAt: row.onboardingCompletedAt } };
}

export async function findSessionByToken(
  token: string,
): Promise<{ session: typeof authSessions.$inferSelect; user: UserRecord } | null> {
  const found = await findSessionWithOnboarding(token);
  return found && { session: found.session, user: found.user };
}

export async function revokeSessionByToken(token: string, reason: string): Promise<void> {
  const database = await getAuthDatabase();
  await database
    .update(authSessions)
    .set({ revokedAt: new Date(), revocationReason: reason })
    .where(
      and(
        eq(authSessions.refreshTokenHash, hashToken(token)),
        isNull(authSessions.revokedAt),
      ),
    );
}
