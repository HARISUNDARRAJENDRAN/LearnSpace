"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

type UploadResponse = {
  resourceId: string;
  versionId: string;
  uploadUrl: string;
  headers: { "Content-Type": string; "If-None-Match": string };
};

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: unknown };
    return typeof body.message === "string" ? body.message : "The upload could not be completed.";
  } catch {
    return "The upload could not be completed.";
  }
}

export function DocumentUploader() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setMessage("Choose a PDF file to upload.");
      return;
    }
    setBusy(true);
    setMessage("Uploading your PDF…");
    let resourceId: string | null = null;
    try {
      const created = await fetch("/api/v1/resources/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || file.name.replace(/\.pdf$/i, ""), fileName: file.name, mimeType: "application/pdf", byteSize: file.size }),
      });
      if (!created.ok) throw new Error(await responseMessage(created));
      const upload = await created.json() as UploadResponse;
      resourceId = upload.resourceId;

      const stored = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: file });
      if (!stored.ok) throw new Error("Private storage rejected the PDF upload.");

      const completed = await fetch(`/api/v1/resources/${encodeURIComponent(upload.resourceId)}/upload-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: upload.versionId }),
      });
      if (!completed.ok) throw new Error(await responseMessage(completed));

      setMessage("PDF uploaded. LearnSpace is extracting its text now.");
      setTitle("");
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    } catch (error) {
      if (resourceId) {
        await fetch(`/api/v1/resources/${encodeURIComponent(resourceId)}/file`, { method: "DELETE" }).catch(() => undefined);
      }
      setMessage(error instanceof Error ? error.message : "The upload could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="document-uploader" onSubmit={(event) => void upload(event)}>
      <label>Title <input maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Use the file name" /></label>
      <label>PDF file <input ref={fileInput} type="file" accept=".pdf,application/pdf" required disabled={busy} /></label>
      <button type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload PDF"}</button>
      <span className="document-uploader-message" role="status" aria-live="polite">{message}</span>
      <small>PDF only, up to 25 MB. Documents stay private to your account.</small>
    </form>
  );
}
