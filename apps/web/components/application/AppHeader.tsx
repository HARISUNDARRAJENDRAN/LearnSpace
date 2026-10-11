"use client";

import { AlignJustify, Columns2, LayoutGrid, Menu, Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { SourceDiscoveryModal } from "../source-discovery/SourceDiscoveryModal";

export type ApplicationViewMode = "grid" | "compact" | "list";

const viewOptions = [
  { mode: "grid", label: "Grid view", Icon: LayoutGrid },
  { mode: "compact", label: "Compact view", Icon: Columns2 },
  { mode: "list", label: "List view", Icon: AlignJustify },
] as const;

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

type AppHeaderProps = {
  onOpenSearch: () => void;
  user: { displayName: string | null; email: string };
  onMenu: () => void;
  viewMode: ApplicationViewMode;
  onViewModeChange: (mode: ApplicationViewMode) => void;
};

export function AppHeader({ onMenu, viewMode, onViewModeChange, onOpenSearch, user }: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [sourceDiscoveryOpen, setSourceDiscoveryOpen] = useState(false);
  const sourceTriggerRef = useRef<HTMLButtonElement>(null);
  const mode = pathname.startsWith("/app/research") || pathname.startsWith("/app/study/paper/") ? "research" : "learn";
  const isHome = pathname === "/app";
  const isDiscover = pathname.startsWith("/app/discover");
  const hasShellHeading = isHome || pathname === "/app/sessions" || pathname === "/app/library" || pathname === "/app/research" || pathname === "/app/second-brain" || pathname === "/app/settings";
  const showViewControls = pathname === "/app/library";

  return (
    <header className={`application-header${isHome ? " application-header--home" : ""}`}>
      <div className="application-header-bottom">
        <div className="application-header-start">
          <button className="application-menu-button" type="button" onClick={onMenu} aria-label="Open navigation">
            <Menu aria-hidden="true" />
          </button>
          <button className="application-header-create" type="button" ref={sourceTriggerRef} onClick={() => setSourceDiscoveryOpen(true)} aria-label={mode === "research" ? "Start research" : "Start learning"} title={mode === "research" ? "Start research" : "Start learning"}>
            <span><Plus aria-hidden="true" /></span>
          </button>
          {isDiscover ? (
            <div className="discover-page-header">
              {pathname === "/app/discover" ? <h1>Discover</h1> : <span className="application-header-title">Discover</span>}
            </div>
          ) : <div className={isHome ? "application-header-context application-header-context--home" : "application-header-context"}>
            {isHome ? <div className="application-header-title-row"><h1 className="application-header-title">Home</h1></div> : hasShellHeading ? <h1 className="application-header-title">{contextLabel(pathname)}</h1> : <span className="application-header-title">{contextLabel(pathname)}</span>}
          </div>}
        </div>

        <div className="application-header-actions">
          {isHome ? <><button type="button" className="application-header-search" onClick={onOpenSearch} aria-label="Search your study sessions"><Search aria-hidden="true" /><span>Search your study sessions…</span></button><Link href="/app/settings" className="application-header-avatar" aria-label="Account settings">{(user.displayName || user.email).trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}</Link></> : null}
          {showViewControls && (
            <fieldset className="application-header-view-group">
              <legend className="sr-only">Page layout</legend>
              {viewOptions.map(({ mode: option, label, Icon }) => (
                <button key={option} className={viewMode === option ? "is-active" : ""} type="button" aria-label={label} aria-pressed={viewMode === option} title={label} onClick={() => onViewModeChange(option)}>
                  <Icon aria-hidden="true" />
                </button>
              ))}
            </fieldset>
          )}
        </div>
      </div>

      <SourceDiscoveryModal key={mode} mode={mode} isOpen={sourceDiscoveryOpen} onClose={() => setSourceDiscoveryOpen(false)} onSwitchMode={(nextMode) => router.push(nextMode === "research" ? "/app/research" : "/app")} triggerRef={sourceTriggerRef} />
    </header>
  );
}
