import { NextResponse, type NextRequest } from "next/server";

import {
  startDesktopAuthHandoff,
  validDesktopFlowId,
  validDesktopVerifier,
} from "../../../../../lib/auth/desktop-handoff";
import { AuthError, authErrorResponse } from "../../../../../lib/auth/errors";
import { enforceRateLimit } from "../../../../../lib/auth/rate-limit";

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
    const verifier = body && typeof body === "object"
      ? (body as Record<string, unknown>).verifier
      : undefined;
    if (!validDesktopFlowId(flowId) || typeof verifier !== "string" || !validDesktopVerifier(verifier)) {
      throw new AuthError("INVALID_REQUEST", "Invalid desktop authentication request.", 400);
    }
    await enforceRateLimit({
      request,
      bucket: "desktop-auth-start",
      limit: 20,
      windowSeconds: 10 * 60,
    });
    if (!await startDesktopAuthHandoff(flowId, verifier)) {
      throw new AuthError("INVALID_REQUEST", "Desktop authentication request already exists.", 409);
    }
    return NextResponse.json({ status: "pending" }, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
