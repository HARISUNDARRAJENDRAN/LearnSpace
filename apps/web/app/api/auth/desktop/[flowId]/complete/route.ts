import { NextResponse, type NextRequest } from "next/server";

import { redeemDesktopAuthHandoff, validDesktopFlowId, validDesktopVerifier } from "../../../../../../lib/auth/desktop-handoff";
import { AuthError, authErrorResponse } from "../../../../../../lib/auth/errors";
import { enforceRateLimit } from "../../../../../../lib/auth/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ flowId: string }> },
) {
  try {
    const { flowId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AuthError("INVALID_REQUEST", "Invalid desktop authentication request.", 400);
    }
    const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const verifier = input.verifier;
    const code = input.code;
    if (
      !validDesktopFlowId(flowId) || typeof verifier !== "string" ||
      !validDesktopVerifier(verifier) || typeof code !== "string" || !validDesktopVerifier(code)
    ) {
      throw new AuthError("INVALID_REQUEST", "Invalid desktop authentication request.", 400);
    }
    await enforceRateLimit({
      request,
      bucket: "desktop-auth-complete",
      identifier: flowId,
      limit: 20,
      windowSeconds: 10 * 60,
    });
    const result = await redeemDesktopAuthHandoff(flowId, verifier, code);
    if (!result) {
      throw new AuthError("INVALID_REQUEST", "The desktop sign-in code is invalid or expired.", 400);
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
