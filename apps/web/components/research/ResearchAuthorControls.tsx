"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function FollowAuthorButton({ authorId, followed, compact = false }: { authorId: string; followed: boolean; compact?: boolean }) {
  const router = useRouter();
  const [isFollowed, setFollowed] = useState(followed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function toggle() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(`/api/v1/research/authors/${authorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ follow: !isFollowed }),
      });
      if (!response.ok) throw new Error("Could not update author preference");
      setFollowed(!isFollowed);
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return <button type="button" className={`research-follow${compact ? " is-compact" : ""}${isFollowed ? " is-followed" : ""}`} onClick={() => void toggle()} disabled={busy} aria-pressed={isFollowed}>
    {busy ? "Saving…" : error ? "Retry" : isFollowed ? "Following" : "Follow"}
  </button>;
}
