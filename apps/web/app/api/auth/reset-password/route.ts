import { NextResponse, type NextRequest } from "next/server";
import { hashPassword } from "../../../../lib/auth/crypto";
import { authErrorResponse, AuthError } from "../../../../lib/auth/errors";
import { resetPasswordWithChallenge } from "../../../../lib/auth/repository";
import { enforceRateLimit } from "../../../../lib/auth/rate-limit";
import { readJson } from "../../../../lib/auth/request";
import { resetPasswordInputSchema } from "../../../../lib/auth/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const input = resetPasswordInputSchema.parse(await readJson(request));
    await enforceRateLimit({
      request,
      bucket: "reset-password",
      identifier: input.token,
      limit: 8,
      windowSeconds: 15 * 60,
    });
    const passwordHash = await hashPassword(input.password);
    const reset = await resetPasswordWithChallenge(input.token, passwordHash);
    if (!reset) {
      throw new AuthError(
        "RESET_TOKEN_INVALID",
        "This reset link is invalid or has expired.",
        400,
      );
    }

    return NextResponse.json({ ok: true, redirectTo: "/login?reset=1" });
  } catch (error) {
    return authErrorResponse(error);
  }
}
