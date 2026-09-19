"use client";

import { Columns2, Grid2X2, Menu, MoreHorizontal, Plus, Rows3 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { SourceDiscoveryModal } from "../source-discovery/SourceDiscoveryModal";

function contextLabel(pathname: string): string {
  if (pathname === "/app") return "Home";
  if (pathname.startsWith("/app/discover")) return "Discover";
  if (pathname.startsWith("/app/sessions")) return "Sessions";
  if (pathname.startsWith("/app/library")) return "Library";
  if (pathname.startsWith("/app/research")) return "Research";
  if (pathname.startsWith("/app/second-brain")) return "Second Brain";
  if (pathname.startsWith("/app/settings")) return "Settings";
  if (pathname.startsWith("/app/study")) return "Study session";
  return "LearnSpace";
}

export function AppHeader({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sourceDiscoveryOpen, setSourceDiscoveryOpen] = useState(false);
  const sourceTriggerRef = useRef<HTMLAnchorElement>(null);
  const mode = pathname.startsWith("/app/research") ? "research" : "learn";
  const newItemHref = pathname.startsWith("/app/research") ? "/app/research" : "/app/discover";
  return (
    <header className={`application-header ${sourceDiscoveryOpen ? "has-source-discovery" : ""}`}>
      <div className="application-header-start">
        <button className="application-menu-button" type="button" onClick={onMenu} aria-label="Open navigation">
          <Menu aria-hidden="true" />
        </button>
        <Link className="application-header-create" href={newItemHref} ref={sourceTriggerRef} onClick={(event) => { event.preventDefault(); setSourceDiscoveryOpen(true); }} aria-label={mode === "research" ? "Start research" : "Start learning"} title={mode === "research" ? "Start research" : "Start learning"}>
          <span><Plus aria-hidden="true" /></span>
        </Link>
        <div className="application-header-context">
          <span className="application-header-title">{contextLabel(pathname)}</span>
        </div>
      </div>
      <div className="application-header-actions">
        <fieldset className="application-header-view-switcher" aria-label="View options">
          <button type="button" className="is-active" aria-label="Grid view" aria-pressed="true"><Grid2X2 aria-hidden="true" /></button>
          <button type="button" aria-label="Column view" aria-pressed="false"><Columns2 aria-hidden="true" /></button>
          <button type="button" aria-label="List view" aria-pressed="false"><Rows3 aria-hidden="true" /></button>
        </fieldset>
        <button className="application-header-more" type="button" aria-label="More options">
          <MoreHorizontal aria-hidden="true" />
        </button>
      </div>
      <SourceDiscoveryModal key={mode} mode={mode} isOpen={sourceDiscoveryOpen} onClose={() => setSourceDiscoveryOpen(false)} onSwitchMode={(nextMode) => router.push(nextMode === "research" ? "/app/research" : "/app")} triggerRef={sourceTriggerRef} />
    </header>
  );
}
