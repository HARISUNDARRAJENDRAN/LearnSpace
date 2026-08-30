import { NextResponse, type NextRequest } from "next/server";
import { getAuthSecret } from "../../../../lib/auth/config";
import { verifyPassword } from "../../../../lib/auth/crypto";
import { setSessionCookie } from "../../../../lib/auth/cookies";
import { AuthError, authErrorResponse } from "../../../../lib/auth/errors";
import { createSession, findUserByEmail } from "../../../../lib/auth/repository";
import { getSessionContext, readJson } from "../../../../lib/auth/request";
import { safeRedirectPath, loginInputSchema } from "../../../../lib/auth/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const input = loginInputSchema.parse(await readJson(request));
    const user = await findUserByEmail(input.email);
    if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
      throw new AuthError("INVALID_CREDENTIALS", "Email or password is incorrect.", 401);
    }
    if (user.status !== "active") {
      throw new AuthError("ACCOUNT_UNAVAILABLE", "This account is currently unavailable.", 403);
    }
    if (!user.emailVerified) {
      throw new AuthError(
        "EMAIL_NOT_VERIFIED",
        "Verify your email before logging in.",
        403,
      );
    }

    const session = await createSession(
      user.id,
      getSessionContext(request),
      getAuthSecret(),
    );
    const response = NextResponse.json({
      ok: true,
      redirectTo: safeRedirectPath(input.next),
    });
    setSessionCookie(response, session.token, session.maxAge);
    return response;
  } catch (error) {
    return authErrorResponse(error);
  }
}
