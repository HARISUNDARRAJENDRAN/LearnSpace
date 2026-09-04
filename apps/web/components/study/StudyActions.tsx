"use client";

import type { StudyOrigin } from "@learnspace/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";

type StartResponse = { route?: unknown };

function routeFrom(value: unknown): string {
  if (!value || typeof value !== "object" || !("route" in value) || typeof (value as StartResponse).route !== "string") throw new Error("Study route missing");
  return (value as StartResponse).route as string;
}

export function StartStudyButton({ resourceId, origin, recommendationRunId, label = "Start learning", className = "" }: { resourceId: string; origin: StudyOrigin; recommendationRunId?: string; label?: string; className?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  async function start() {
    setState("loading");
    try {
      const response = await fetch("/api/v1/study-sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId, origin, recommendationRunId, idempotencyKey: crypto.randomUUID(), correlationId: crypto.randomUUID() }) });
      if (!response.ok) throw new Error("Study start failed");
      router.push(routeFrom(await response.json()));
    } catch {
      setState("error");
    }
  }
  return <button className={className} type="button" onClick={() => void start()} disabled={state === "loading"}>{state === "loading" ? "Opening…" : state === "error" ? "Try again" : label}</button>;
}

export function SaveResourceButton({ resourceId, saved, className = "" }: { resourceId: string; saved: boolean; className?: string }) {
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
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  return <button className={className} type="button" onClick={() => void toggle()} disabled={loading}>{loading ? "Saving…" : error ? "Try again" : isSaved ? "Saved" : "Save"}</button>;
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
