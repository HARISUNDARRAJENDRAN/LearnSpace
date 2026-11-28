"use client";

import type { ImportSharedFolderResponse } from "@learnspace/shared";
import { AlertCircle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type ImportErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

export function SharedFolderImportClient({ token }: { token: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [status, setStatus] = useState<"importing" | "error">("importing");
  const [errorMessage, setErrorMessage] = useState("");
  const [retryable, setRetryable] = useState(false);

  const runImport = useCallback(async () => {
    setStatus("importing");
    setErrorMessage("");
    setRetryable(false);

    try {
      const response = await fetch(`/api/v1/shared-folders/${encodeURIComponent(token)}/import`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
      });

      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(`/share/${token}`)}`);
        return;
      }

      const body = (await response.json().catch(() => null)) as (ImportSharedFolderResponse & ImportErrorBody) | null;

      if (response.status === 403 && body?.error?.code === "ONBOARDING_REQUIRED") {
        router.replace(`/onboarding?next=${encodeURIComponent(`/share/${token}`)}`);
        return;
      }

      if (!response.ok || !body?.href) {
        setStatus("error");
        setErrorMessage(body?.error?.message ?? "This share link is invalid or has been revoked.");
        setRetryable(response.status >= 500 || response.status === 429);
        return;
      }

      router.replace(body.href);
      router.refresh();
    } catch {
      setStatus("error");
      setErrorMessage("Could not connect to LearnSpace. Check your connection and try again.");
      setRetryable(true);
    }
  }, [router, token]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runImport();
  }, [runImport]);

  if (status === "importing") {
    return (
      <div className="auth-form" role="status" aria-live="polite" style={{ alignItems: "center", textAlign: "center", paddingBlock: "12px" }}>
        <Loader2 className="share-import-spinner" size={26} aria-hidden="true" />
        <p className="auth-verify-copy">Adding this folder to your workspace…</p>
      </div>
    );
  }

  return (
    <div className="auth-form">
      <div className="auth-error" role="alert" style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
        <AlertCircle size={18} style={{ flex: "none", marginTop: "2px" }} aria-hidden="true" />
        <p>{errorMessage}</p>
      </div>
      {retryable ? (
        <button className="auth-submit" type="button" onClick={() => void runImport()}>
          Try again
        </button>
      ) : null}
      <p className="auth-switch">
        <a href="/app">Go to LearnSpace</a>
      </p>
    </div>
  );
}
