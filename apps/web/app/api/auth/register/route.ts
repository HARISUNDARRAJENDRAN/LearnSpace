import { NextResponse, type NextRequest } from "next/server";
import {
  assertEmailDeliveryConfigured,
  getAppBaseUrl,
  getAuthSecret,
} from "../../../../lib/auth/config";
import { createVerificationToken, hashPassword } from "../../../../lib/auth/crypto";
import { sendVerificationEmail } from "../../../../lib/auth/email";
import { AuthError, authErrorResponse, isUniqueViolation } from "../../../../lib/auth/errors";
import { createEmailUser, findUserByEmail } from "../../../../lib/auth/repository";
import { readJson } from "../../../../lib/auth/request";
import { safeRedirectPath, registerInputSchema } from "../../../../lib/auth/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const input = registerInputSchema.parse(await readJson(request));
    const secret = getAuthSecret();
    assertEmailDeliveryConfigured();

    if (await findUserByEmail(input.email)) {
      throw new AuthError(
        "EMAIL_IN_USE",
        "An account with that email already exists. Try logging in instead.",
        409,
      );
    }

    const user = await createEmailUser({
      email: input.email,
      displayName: input.displayName,
      passwordHash: await hashPassword(input.password),
    });
    const next = safeRedirectPath(input.next);
    const verificationToken = createVerificationToken(
      {
        userId: user.id,
        email: user.email,
        next,
        exp: Date.now() + 1000 * 60 * 60 * 24,
      },
      secret,
    );
    const verificationUrl = new URL("/api/auth/verify", getAppBaseUrl(request));
    verificationUrl.searchParams.set("token", verificationToken);
    const delivery = await sendVerificationEmail({
      email: user.email,
      displayName: user.displayName ?? input.displayName,
      verificationUrl: verificationUrl.toString(),
    });
    const responseBody: {
      ok: true;
      redirectTo: string;
      verificationUrl?: string;
    } = {
      ok: true,
      redirectTo: "/verify-email",
    };

    if (delivery.verificationUrl) {
      responseBody.verificationUrl = delivery.verificationUrl;
    }

    return NextResponse.json(responseBody, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return authErrorResponse(
        new AuthError(
          "EMAIL_IN_USE",
          "An account with that email already exists. Try logging in instead.",
          409,
        ),
      );
    }
    return authErrorResponse(error);
  }
}
