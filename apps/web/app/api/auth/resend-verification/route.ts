import { NextResponse, type NextRequest } from "next/server";
import { assertEmailDeliveryConfigured, getAppBaseUrl } from "../../../../lib/auth/config";
import { sendVerificationEmail } from "../../../../lib/auth/email";
import { authErrorResponse } from "../../../../lib/auth/errors";
import {
  createAuthChallenge,
  findUserByEmail,
} from "../../../../lib/auth/repository";
import { enforceRateLimit } from "../../../../lib/auth/rate-limit";
import { readJson } from "../../../../lib/auth/request";
import { resendVerificationInputSchema, safeRedirectPath } from "../../../../lib/auth/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const input = resendVerificationInputSchema.parse(await readJson(request));
    await enforceRateLimit({
      request,
      bucket: "resend-verification",
      identifier: input.email,
      limit: 5,
      windowSeconds: 15 * 60,
    });

    const responseBody: {
      ok: true;
      message: string;
      verificationUrl?: string;
    } = {
      ok: true,
      message: "If that account needs verification, a new email is on its way.",
    };
    const user = await findUserByEmail(input.email);

    if (user && !user.emailVerified && user.passwordHash) {
      try {
        assertEmailDeliveryConfigured();
        const verificationToken = await createAuthChallenge(
          user.id,
          "email_verification",
          new Date(Date.now() + 1000 * 60 * 60 * 24),
        );
        const verificationUrl = new URL("/api/auth/verify", getAppBaseUrl(request));
        verificationUrl.searchParams.set("token", verificationToken);
        verificationUrl.searchParams.set("next", safeRedirectPath(input.next));
        const delivery = await sendVerificationEmail({
          email: user.email,
          displayName: user.displayName ?? "learner",
          verificationUrl: verificationUrl.toString(),
        });
        if (delivery.verificationUrl) {
          responseBody.verificationUrl = delivery.verificationUrl;
        }
      } catch (error) {
        console.error("[auth] verification email resend failed", error);
      }
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    return authErrorResponse(error);
  }
}
