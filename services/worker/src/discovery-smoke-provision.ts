import postgres from "postgres";
import { hashPassword } from "@learnspace/shared/password";

type SqlClient = ReturnType<typeof postgres>;

type SmokeLearnerInput = {
  email: string;
  password: string;
  conceptId: string;
};

export const DISCOVERY_SMOKE_SYSTEM_ACCOUNT = "discovery-smoke-v1";

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function hasSmokeAccountMarker(profile: unknown): boolean {
  return objectValue(profile).systemAccount === DISCOVERY_SMOKE_SYSTEM_ACCOUNT;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function provisionSmokeLearner(
  sql: SqlClient,
  input: SmokeLearnerInput,
): Promise<string> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) throw new Error("smoke learner credentials are required");
  const passwordHash = await hashPassword(input.password);

  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`learnspace:smoke-learner:${email}`}))`;
    const accounts = await tx<{ user_id: string; profile: unknown }[]>`
      SELECT user_id, profile
      FROM identity.auth_accounts
      WHERE provider = 'email' AND lower(provider_account_id) = ${email}
      FOR UPDATE
    `;
    const existingAccount = accounts[0];
    const users = await tx<{ id: string }[]>`
      SELECT id
      FROM identity.users
      WHERE lower(email) = ${email}
      FOR UPDATE
    `;
    let userId = users[0]?.id;
    if (existingAccount) {
      if (!userId || existingAccount.user_id !== userId || !hasSmokeAccountMarker(existingAccount.profile)) {
        throw new Error("smoke learner email belongs to a non-smoke account");
      }
    } else if (userId) {
      throw new Error("smoke learner email has no smoke account marker");
    }

    if (userId) {
      await tx`
        UPDATE identity.users
        SET password_hash = ${passwordHash},
            email_verified = true,
            status = 'active',
            updated_at = now(),
            deleted_at = NULL
        WHERE id = ${userId}
      `;
    } else {
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO identity.users
          (email, email_verified, password_hash, status, display_name, locale, timezone, subscription_tier)
        VALUES (${email}, true, ${passwordHash}, 'active', 'Discovery Smoke Learner', 'en', 'UTC', 'free')
        RETURNING id
      `;
      userId = inserted[0]?.id;
    }
    if (!userId) throw new Error("smoke learner could not be provisioned");

    if (existingAccount) {
      await tx`
        UPDATE identity.auth_accounts
        SET provider_email = ${email}, email_verified = true,
            profile = ${tx.json({ ...objectValue(existingAccount.profile), systemAccount: DISCOVERY_SMOKE_SYSTEM_ACCOUNT })},
            updated_at = now()
        WHERE provider = 'email' AND lower(provider_account_id) = ${email}
      `;
    } else {
      await tx`
        INSERT INTO identity.auth_accounts
          (user_id, provider, provider_account_id, provider_email, email_verified, profile)
        VALUES (${userId}, 'email', ${email}, ${email}, true, ${tx.json({ systemAccount: DISCOVERY_SMOKE_SYSTEM_ACCOUNT })})
      `;
    }

    const settings = await tx<{ learning_preferences: unknown }[]>`
      SELECT learning_preferences
      FROM identity.user_settings
      WHERE user_id = ${userId}
      FOR UPDATE
    `;
    const currentPreferences = objectValue(settings[0]?.learning_preferences);
    const conceptIds = [...new Set([
      ...stringArray(currentPreferences.conceptIds),
      input.conceptId,
    ])];
    const preferences = {
      ...currentPreferences,
      persona: typeof currentPreferences.persona === "string" ? currentPreferences.persona : "lifelong_learner",
      learningIntents: stringArray(currentPreferences.learningIntents).length > 0
        ? stringArray(currentPreferences.learningIntents)
        : ["explore"],
      preferredFormats: stringArray(currentPreferences.preferredFormats),
      preferredDuration: typeof currentPreferences.preferredDuration === "string"
        ? currentPreferences.preferredDuration
        : "no_preference",
      selfReportedLevel: "mixed",
      conceptIds,
    };
    if (settings[0]) {
      await tx`
        UPDATE identity.user_settings
        SET learning_preferences = ${tx.json(preferences)},
            onboarding_completed_at = COALESCE(onboarding_completed_at, now()),
            onboarding_version = COALESCE(onboarding_version, 1),
            updated_at = now()
        WHERE user_id = ${userId}
      `;
    } else {
      await tx`
        INSERT INTO identity.user_settings
          (user_id, learning_preferences, onboarding_completed_at, onboarding_version)
        VALUES (${userId}, ${tx.json(preferences)}, now(), 1)
      `;
    }

    await tx`
      UPDATE identity.auth_sessions
      SET revoked_at = COALESCE(revoked_at, now()), revocation_reason = 'staging_smoke_preflight'
      WHERE user_id = ${userId} AND revoked_at IS NULL
    `;
    return userId;
  });
}
