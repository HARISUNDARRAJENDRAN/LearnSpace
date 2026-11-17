"use client";

import { useEffect, useMemo, useState } from "react";
import type { PaperContent } from "../../lib/research/paper-content";
import type { PaperSection } from "./PaperReader";

/** The parsed paper, plus its table of contents in the shape the PDF reader's section picker takes. */
export function usePaperContent(resourceId: string) {
  const [content, setContent] = useState<PaperContent | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setContent(null);
    setFailed(false);
    fetch(`/api/v1/papers/${resourceId}/content`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(String(response.status)); setContent(await response.json() as PaperContent); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [resourceId]);
  const sections = useMemo<PaperSection[]>(() => (content?.blocks ?? []).flatMap((block) => block.type === "heading" && block.sectionId && block.page
    ? [{ id: block.sectionId, title: block.content, depth: block.headingPath.length, page: block.page }]
    : []), [content]);
  return { content, failed, sections };
}
