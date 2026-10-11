import { NextResponse, type NextRequest } from "next/server";
import { assertEmailDeliveryConfigured } from "../../../../lib/auth/config";
import { passwordResetActionUrl } from "../../../../lib/auth/action-url";
import { sendPasswordResetEmail } from "../../../../lib/auth/email";
import { authErrorResponse } from "../../../../lib/auth/errors";
import { createAuthChallenge, findUserByEmail } from "../../../../lib/auth/repository";
import { enforceRateLimit } from "../../../../lib/auth/rate-limit";
import { readJson } from "../../../../lib/auth/request";
import { forgotPasswordInputSchema } from "../../../../lib/auth/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const input = forgotPasswordInputSchema.parse(await readJson(request));
    await enforceRateLimit({
      request,
      bucket: "forgot-password",
      identifier: input.email,
      limit: 5,
      windowSeconds: 15 * 60,
    });

    const responseBody: { ok: true; message: string; resetUrl?: string } = {
      ok: true,
      message: "If an account matches that email, a password reset link is on its way.",
    };
    const user = await findUserByEmail(input.email);

    if (user?.passwordHash) {
      try {
        assertEmailDeliveryConfigured();
        const token = await createAuthChallenge(
          user.id,
          "password_reset",
          new Date(Date.now() + 1000 * 60 * 60),
        );
        const resetUrl = passwordResetActionUrl(request, token);
        const delivery = await sendPasswordResetEmail({
          email: user.email,
          displayName: user.displayName ?? "learner",
          resetUrl: resetUrl.toString(),
        });
        if (delivery.resetUrl) {
          responseBody.resetUrl = delivery.resetUrl;
        }
      } catch (error) {
        console.error("[auth] password reset email failed", error);
      }
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    return authErrorResponse(error);
  }
}
