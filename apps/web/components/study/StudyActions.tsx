"use client";

import type { SourceDiscoveryMode, StudyOrigin } from "@learnspace/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";

type StartResponse = { route?: unknown };

function routeFrom(value: unknown): string {
  if (!value || typeof value !== "object" || !("route" in value) || typeof (value as StartResponse).route !== "string") throw new Error("Study route missing");
  return (value as StartResponse).route as string;
}

export function StartStudyButton({ resourceId, sourceUrl, sourceMode, origin, recommendationRunId, label = "Start learning", className = "", onClick }: { resourceId?: string; sourceUrl?: string; sourceMode?: SourceDiscoveryMode; origin: StudyOrigin; recommendationRunId?: string | null; label?: string; className?: string; onClick?: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  async function start() {
    setState("loading");
    try {
      let canonicalResourceId = resourceId;
      if (!canonicalResourceId && sourceUrl && sourceMode) {
        const resolved = await fetch("/api/v1/source-discovery/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: sourceMode, url: sourceUrl, correlationId: crypto.randomUUID(), recommendationRunId: recommendationRunId ?? undefined }),
        });
        if (!resolved.ok) throw new Error("Source canonicalization failed");
        const body = await resolved.json() as { preview?: { resourceId?: string } };
        canonicalResourceId = body.preview?.resourceId;
      }
      if (!canonicalResourceId) throw new Error("Study resource missing");
      const response = await fetch("/api/v1/study-sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId: canonicalResourceId, origin, recommendationRunId: recommendationRunId ?? undefined, idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() }) });
      if (!response.ok) throw new Error("Study start failed");
      onClick?.();
      router.push(routeFrom(await response.json()));
    } catch {
      setState("error");
    }
  }
  return <button className={className} type="button" onClick={() => void start()} disabled={state === "loading"}>{state === "loading" ? "Opening…" : state === "error" ? "Try again" : label}</button>;
}

export function SaveResourceButton({ resourceId, saved, savedLabel = "Saved", className = "" }: { resourceId: string; saved: boolean; savedLabel?: string; className?: string }) {
  const router = useRouter();
  const [isSaved, setSaved] = useState(saved);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  async function toggle() {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/v1/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId, action: isSaved ? "remove" : "save" }) });
      if (!response.ok) throw new Error("Library update failed");
      setSaved(!isSaved);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  return <button className={className} type="button" onClick={() => void toggle()} disabled={loading}>{loading ? "Saving…" : error ? "Try again" : isSaved ? savedLabel : "Save"}</button>;
}

export function StartCollectionButton({ collectionId, label }: { collectionId: string; label: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  async function start() {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`/api/v1/library/collections/${collectionId}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) });
      if (!response.ok) throw new Error("Collection start failed");
      router.push(routeFrom(await response.json()));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  return <button type="button" onClick={() => void start()} disabled={loading}>{loading ? "Opening…" : error ? "Try again" : label}</button>;
}
