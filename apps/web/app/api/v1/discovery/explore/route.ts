import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { NextResponse } from "next/server";
import { authErrorResponse } from "../../../../../lib/auth/errors";
import { requireCompletedSession } from "../../../../../lib/discovery/access";
import { getHomeFeed } from "../../../../../lib/discovery/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requireCompletedSession();
    const topic = z.string().uuid().nullable().safeParse(request.nextUrl.searchParams.get("topic"));
    if (!topic.success) return NextResponse.json({ error: "Choose a valid learning interest." }, { status: 400 });
    let timing = "";
    const feed = await getHomeFeed(session.user.id, "discover", { topicId: topic.data, scheduleRefresh: (work) => after(work), onTiming: (values) => { timing = Object.entries(values).filter(([key, value]) => typeof value === "number" && key !== "candidates" && key !== "returned").map(([key, value]) => `${key};dur=${Number(value).toFixed(2)}`).join(", "); } });
    const started = performance.now();
    const body = JSON.stringify(feed);
    const serialization = performance.now() - started;
    return new NextResponse(body, { headers: { "Content-Type": "application/json", "Server-Timing": `${timing}, serialization;dur=${serialization.toFixed(2)}`, "Cache-Control": "private, no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}
