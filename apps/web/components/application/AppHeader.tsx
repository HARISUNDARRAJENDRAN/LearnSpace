"use client";

import { AlignJustify, Columns2, LayoutGrid, Menu, Plus } from "lucide-react";
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
  onMenu: () => void;
  viewMode: ApplicationViewMode;
  onViewModeChange: (mode: ApplicationViewMode) => void;
};

export function AppHeader({ onMenu, viewMode, onViewModeChange }: AppHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [sourceDiscoveryOpen, setSourceDiscoveryOpen] = useState(false);
  const sourceTriggerRef = useRef<HTMLButtonElement>(null);
  const mode = pathname.startsWith("/app/research") || pathname.startsWith("/app/study/paper/") ? "research" : "learn";
  const isHome = pathname === "/app";
  const isDiscover = pathname === "/app/discover";
  const hasShellHeading = isHome || pathname === "/app/sessions" || pathname === "/app/library" || pathname === "/app/research" || pathname === "/app/second-brain" || pathname === "/app/settings";
  const showViewControls = pathname === "/app/library";

  return (
    <header className={`application-header${isHome ? " application-header--home" : ""}`}>
      <div className="application-header-bottom">
        <div className="application-header-start">
          <button className="application-menu-button" type="button" onClick={onMenu} aria-label="Open navigation">
            <Menu aria-hidden="true" />
          </button>
          {isDiscover ? (
            <div className="discover-page-header">
              <span className="discover-page-mark" aria-hidden="true">
                <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
                  <defs>
                    <radialGradient id="discover-compass-surface" cx="30%" cy="22%" r="88%">
                      <stop stopColor="#2b2d31" />
                      <stop offset=".58" stopColor="#202124" />
                      <stop offset="1" stopColor="#111214" />
                    </radialGradient>
                  </defs>
                  <circle cx="20" cy="20" r="17.25" fill="url(#discover-compass-surface)" />
                  <circle cx="20" cy="20" r="17" stroke="#090a0c" strokeOpacity=".85" strokeWidth=".5" />
                  <circle cx="20" cy="20" r="11.8" stroke="#f7f7f6" strokeWidth="1.8" />
                  <path d="M26 14 21.38 21.38 18.62 18.62 26 14Z" fill="#fafaf9" />
                  <path d="M14 26 18.62 18.62 21.38 21.38 14 26Z" fill="#fafaf9" />
                </svg>
              </span>
              <div>
                <h1>Discover</h1>
                <p>Explore new topics, build your skills, and follow your curiosity.</p>
              </div>
            </div>
          ) : <button className="application-header-create" type="button" ref={sourceTriggerRef} onClick={() => setSourceDiscoveryOpen(true)} aria-label={mode === "research" ? "Start research" : "Start learning"} title={mode === "research" ? "Start research" : "Start learning"}>
            <span><Plus aria-hidden="true" /></span>
          </button>}
          {!isDiscover && <div className={isHome ? "application-header-context application-header-context--home" : "application-header-context"}>
            {isHome ? <div className="application-header-title-row"><h1 className="application-header-title">Home</h1><span className="application-home-data-note">Sample data</span></div> : hasShellHeading ? <h1 className="application-header-title">{contextLabel(pathname)}</h1> : <span className="application-header-title">{contextLabel(pathname)}</span>}
            {isHome && <p className="application-header-subtitle">Pick up where you left off.</p>}
          </div>}
        </div>

        <div className="application-header-actions">
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
