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
    let timer: ReturnType<typeof setTimeout> | undefined;
    setContent(null);
    setFailed(false);
    const read = async () => {
      try {
        const response = await fetch(`/api/v1/papers/${resourceId}/content`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const paper = await response.json() as PaperContent;
        if (controller.signal.aborted) return;
        setContent(paper);
        if (paper.status === "preparing") timer = setTimeout(read, 4_000);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [resourceId]);
  const sections = useMemo<PaperSection[]>(() => (content?.blocks ?? []).flatMap((block) => block.type === "heading" && block.sectionId && block.page
    ? [{ id: block.sectionId, title: block.content, depth: block.headingPath.length, page: block.page }]
    : []), [content]);
  return { content, failed, sections };
}
