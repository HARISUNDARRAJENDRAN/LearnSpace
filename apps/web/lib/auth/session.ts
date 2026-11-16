import { cookies } from "next/headers";
import { sessionCookieName } from "./cookies";
import { AuthError } from "./errors";
import { findSessionByToken, findSessionWithOnboarding, type PublicUser, type SessionLookup, type UserRecord } from "./repository";

export type CurrentSession = NonNullable<Awaited<ReturnType<typeof findSessionByToken>>>;

export async function getCurrentSession(): Promise<CurrentSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  if (!token) {
    return null;
  }

  const result = await findSessionByToken(token);
  return result;
}

export async function requireCurrentSession(): Promise<CurrentSession> {
  const currentSession = await getCurrentSession();
  if (!currentSession) {
    throw new AuthError("UNAUTHENTICATED", "Sign in to continue.", 401);
  }
  return currentSession;
}

/** The signed-in session and whether its learner finished onboarding, read together. */
export async function requireCurrentSessionWithOnboarding(): Promise<SessionLookup> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  const found = token ? await findSessionWithOnboarding(token) : null;
  if (!found) {
    throw new AuthError("UNAUTHENTICATED", "Sign in to continue.", 401);
  }
  return found;
}

export function publicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    subscriptionTier: user.subscriptionTier,
  };
}
