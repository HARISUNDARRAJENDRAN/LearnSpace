"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useRef, useState } from "react";
import { AppHeader, type ApplicationViewMode } from "./AppHeader";
import { AppSidebar, type RecentSession } from "./AppSidebar";
import { HeaderSearch } from "./HeaderSearch";
import { SmoothScroll } from "./SmoothScroll";

// Lets workspaces that need the room (study sessions) fold the sidebar away.
export const CollapseSidebarContext = createContext<() => void>(() => {});

type ApplicationUser = {
  email: string;
  displayName: string | null;
};

export function ApplicationShell({ user, recentSessions, hasCurrentSession, children }: { user: ApplicationUser; recentSessions: RecentSession[]; hasCurrentSession: boolean; children: ReactNode }) {
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
  const searchMode = pathname.startsWith("/app/research") || pathname.startsWith("/app/study/paper/") ? "research" : "learn";

  return (
    <div className={`application-page${sidebarCollapsed ? " is-sidebar-collapsed" : ""}${pathname.startsWith("/app/discover") ? " application-page--discover" : ""}`} data-view={viewMode}>
      <AppSidebar
        user={user}
        recentSessions={recentSessions}
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onOpenSearch={openSearch}
        onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
      />
      <div className="application-main">
        <AppHeader canStartNew={!hasCurrentSession} onMenu={() => setSidebarOpen(true)} viewMode={viewMode} onViewModeChange={setViewMode} search={<HeaderSearch inputRef={searchRef} mode={searchMode} recentSessions={recentSessions} />} />
        <div className="application-body"><CollapseSidebarContext value={collapseSidebar}>{children}</CollapseSidebarContext></div>
      </div>
      <SmoothScroll />
    </div>
  );
}
