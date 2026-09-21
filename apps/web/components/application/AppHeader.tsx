"use client";

import { Menu, Plus } from "lucide-react";
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
  const sourceTriggerRef = useRef<HTMLButtonElement>(null);
  const mode = pathname.startsWith("/app/research") || pathname.startsWith("/app/study/paper/") ? "research" : "learn";
  return (
    <header className={`application-header${pathname === "/app" ? " application-header-home" : ""}`}>
      <div className="application-header-start">
        <button className="application-menu-button" type="button" onClick={onMenu} aria-label="Open navigation">
          <Menu aria-hidden="true" />
        </button>
        <button className="application-header-create" type="button" ref={sourceTriggerRef} onClick={() => setSourceDiscoveryOpen(true)} aria-label={mode === "research" ? "Start research" : "Start learning"} title={mode === "research" ? "Start research" : "Start learning"}>
          <span><Plus aria-hidden="true" /></span>
        </button>
        <div className="application-header-context">
          <span className="application-header-title">{contextLabel(pathname)}</span>
        </div>
      </div>
      <SourceDiscoveryModal key={mode} mode={mode} isOpen={sourceDiscoveryOpen} onClose={() => setSourceDiscoveryOpen(false)} onSwitchMode={(nextMode) => router.push(nextMode === "research" ? "/app/research" : "/app")} triggerRef={sourceTriggerRef} />
    </header>
  );
}
