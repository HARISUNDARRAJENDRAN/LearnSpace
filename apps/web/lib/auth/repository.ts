import { authAccounts, authSessions, userSettings, users } from "@learnspace/db/schema";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  createOpaqueToken,
  hashIpAddress,
  hashToken,
} from "./crypto";

const sessionLifetimeSeconds = 60 * 60 * 24 * 30;

async function getAuthDatabase() {
  const { authDb } = await import("@learnspace/db");
  return authDb;
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
  const rows = await database
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
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
    await tx.insert(userSettings).values({ userId });
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
  const accountRows = await database
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

  if (existingAccount) {
    const user = await findUserById(existingAccount.userId);
    if (!user) {
      throw new Error("Google account is linked to a missing user");
    }

    await database
      .update(users)
      .set({
        emailVerified: true,
        displayName: input.displayName ?? user.displayName,
        avatarUrl: input.avatarUrl ?? user.avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    await database
      .update(authAccounts)
      .set({
        providerEmail: input.email,
        emailVerified: true,
        profile: input.profile,
        updatedAt: new Date(),
      })
      .where(eq(authAccounts.id, existingAccount.id));
    return (await findUserById(user.id)) ?? user;
  }

  const existingUser = await findUserByEmail(input.email);
  const userId = existingUser?.id ?? randomUUID();

  if (existingUser) {
    await database
      .update(users)
      .set({
        emailVerified: true,
        displayName: input.displayName ?? existingUser.displayName,
        avatarUrl: input.avatarUrl ?? existingUser.avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existingUser.id));
  } else {
    await database.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        email: input.email,
        emailVerified: true,
        passwordHash: null,
        status: "active",
        displayName: input.displayName ?? input.email.split("@")[0],
        avatarUrl: input.avatarUrl ?? null,
        locale: "en",
        timezone: "UTC",
        subscriptionTier: "free",
      });
      await tx.insert(userSettings).values({ userId });
    });
  }

  await database.insert(authAccounts).values({
    userId,
    provider: "google",
    providerAccountId: input.providerAccountId,
    providerEmail: input.email,
    emailVerified: true,
    profile: input.profile,
  });

  const user = await findUserById(userId);
  if (!user) {
    throw new Error("Google user could not be loaded");
  }
  return user;
}

export async function markEmailVerified(userId: string): Promise<UserRecord | null> {
  const database = await getAuthDatabase();
  await database
    .update(users)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return findUserById(userId);
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

export async function findSessionByToken(
  token: string,
): Promise<{ session: typeof authSessions.$inferSelect; user: UserRecord } | null> {
  const database = await getAuthDatabase();
  const rows = await database
    .select()
    .from(authSessions)
    .where(
      and(
        eq(authSessions.refreshTokenHash, hashToken(token)),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const session = rows[0];
  if (!session) {
    return null;
  }

  const user = await findUserById(session.userId);
  if (!user || user.status !== "active") {
    return null;
  }

  await database
    .update(authSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(authSessions.id, session.id));

  return { session, user };
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
