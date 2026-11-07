"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { AppHeader, type ApplicationViewMode } from "./AppHeader";
import { AppSidebar, type RecentSession } from "./AppSidebar";
import { SearchPalette } from "./SearchPalette";
import { SmoothScroll } from "./SmoothScroll";

type ApplicationUser = {
  email: string;
  displayName: string | null;
};

export function ApplicationShell({ user, recentSessions, children }: { user: ApplicationUser; recentSessions: RecentSession[]; children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ApplicationViewMode>("grid");
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
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
        <AppHeader onMenu={() => setSidebarOpen(true)} viewMode={viewMode} onViewModeChange={setViewMode} />
        <div className="application-body">{children}</div>
      </div>
      <SearchPalette isOpen={searchOpen} mode={searchMode} onClose={closeSearch} />
      <SmoothScroll />
    </div>
  );
}
