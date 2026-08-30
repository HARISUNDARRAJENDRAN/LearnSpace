import { NextResponse, type NextRequest } from "next/server";
import { getAppBaseUrl, getAuthSecret, assertEmailDeliveryConfigured } from "../../../../lib/auth/config";
import { createVerificationToken } from "../../../../lib/auth/crypto";
import { sendVerificationEmail } from "../../../../lib/auth/email";
import { authErrorResponse } from "../../../../lib/auth/errors";
import { findUserByEmail } from "../../../../lib/auth/repository";
import { safeRedirectPath, resendVerificationInputSchema } from "../../../../lib/auth/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const input = resendVerificationInputSchema.parse(await request.json());
    const secret = getAuthSecret();
    assertEmailDeliveryConfigured();
    const user = await findUserByEmail(input.email);
    const responseBody: {
      ok: true;
      message: string;
      verificationUrl?: string;
    } = {
      ok: true,
      message: "If that account needs verification, a new email is on its way.",
    };

    if (user && !user.emailVerified && user.passwordHash) {
      const verificationToken = createVerificationToken(
        {
          userId: user.id,
          email: user.email,
          next: safeRedirectPath(input.next),
          exp: Date.now() + 1000 * 60 * 60 * 24,
        },
        secret,
      );
      const verificationUrl = new URL("/api/auth/verify", getAppBaseUrl(request));
      verificationUrl.searchParams.set("token", verificationToken);
      const delivery = await sendVerificationEmail({
        email: user.email,
        displayName: user.displayName ?? "learner",
        verificationUrl: verificationUrl.toString(),
      });
      if (delivery.verificationUrl) {
        responseBody.verificationUrl = delivery.verificationUrl;
      }
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    return authErrorResponse(error);
  }
}
