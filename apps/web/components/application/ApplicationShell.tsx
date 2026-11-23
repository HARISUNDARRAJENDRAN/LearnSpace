"use client";

import type { StudySessionSummary } from "@learnspace/shared";
import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { SessionFoldersProvider } from "../folders/state";
import { prefetchSpeechModels } from "../study/voice/prefetch";
import { AppHeader, type ApplicationViewMode } from "./AppHeader";
import { AppSidebar, modeFromUrl } from "./AppSidebar";
import { HeaderSearch } from "./HeaderSearch";
import { SessionsProvider } from "./sessions";
import { SmoothScroll } from "./SmoothScroll";

// Lets workspaces that need the room (study sessions) fold the sidebar away.
export const CollapseSidebarContext = createContext<() => void>(() => {});

type ApplicationUser = {
  email: string;
  displayName: string | null;
};

export function ApplicationShell({ user, sessions, children }: { user: ApplicationUser; sessions: StudySessionSummary[]; children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [viewMode, setViewMode] = useState<ApplicationViewMode>("grid");
  const searchRef = useRef<HTMLInputElement>(null);
  const openSearch = useCallback(() => {
    setSidebarOpen(false);
    searchRef.current?.focus();
  }, []);
  const collapseSidebar = useCallback(() => setSidebarCollapsed(true), []);
  const searchMode = modeFromUrl(pathname, useSearchParams());
  useEffect(prefetchSpeechModels, []);

  return (
    <SessionsProvider initial={sessions}>
    <SessionFoldersProvider>
    <div className={`application-page${sidebarCollapsed ? " is-sidebar-collapsed" : ""}${pathname.startsWith("/app/discover") ? " application-page--discover" : ""}`} data-view={viewMode}>
      <AppSidebar
        user={user}
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onOpenSearch={openSearch}
        onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
      />
      <div className="application-main">
        <AppHeader onMenu={() => setSidebarOpen(true)} viewMode={viewMode} onViewModeChange={setViewMode} search={<HeaderSearch inputRef={searchRef} mode={searchMode} />} />
        <div className="application-body"><CollapseSidebarContext value={collapseSidebar}>{children}</CollapseSidebarContext></div>
      </div>
      <SmoothScroll />
    </div>
    </SessionFoldersProvider>
    </SessionsProvider>
  );
}
