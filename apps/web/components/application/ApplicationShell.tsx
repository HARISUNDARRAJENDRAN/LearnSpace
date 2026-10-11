"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { AppHeader, type ApplicationViewMode } from "./AppHeader";
import { AppSidebar, type RecentSession } from "./AppSidebar";
import { SearchPalette } from "./SearchPalette";

type ApplicationUser = {
  email: string;
  displayName: string | null;
};

export function ApplicationShell({ user, recentSessions, children }: { user: ApplicationUser; recentSessions: RecentSession[]; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ApplicationViewMode>("grid");
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const searchMode = pathname.startsWith("/app/research") || pathname.startsWith("/app/study/paper/") ? "research" : "learn";

  async function logout() {
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/");
    }
  }

  return (
    <div className={`application-page${sidebarCollapsed ? " is-sidebar-collapsed" : ""}${pathname.startsWith("/app/discover") ? " application-page--discover" : ""}`} data-view={viewMode}>
      <AppSidebar
        user={user}
        recentSessions={recentSessions}
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        isLoggingOut={isLoggingOut}
        onClose={() => setSidebarOpen(false)}
        onOpenSearch={openSearch}
        onLogout={logout}
        onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
      />
      <div className="application-main">
        <AppHeader onMenu={() => setSidebarOpen(true)} viewMode={viewMode} onViewModeChange={setViewMode} onOpenSearch={openSearch} user={user} />
        <div className="application-body">{children}</div>
      </div>
      <SearchPalette isOpen={searchOpen} mode={searchMode} onClose={closeSearch} />
    </div>
  );
}
