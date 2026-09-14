"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppHeader } from "./AppHeader";
import { AppSidebar, type RecentSession } from "./AppSidebar";

type ApplicationUser = {
  email: string;
  displayName: string | null;
};

export function ApplicationShell({ user, recentSessions, children }: { user: ApplicationUser; recentSessions: RecentSession[]; children: ReactNode }) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function logout() {
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/");
    }
  }

  return (
    <div className={`application-page ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <AppSidebar
        user={user}
        recentSessions={recentSessions}
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        isLoggingOut={isLoggingOut}
        onClose={() => setSidebarOpen(false)}
        onLogout={logout}
        onToggleCollapsed={() => setSidebarCollapsed((collapsed) => !collapsed)}
      />
      <div className="application-main">
        <AppHeader onMenu={() => setSidebarOpen(true)} />
        <div className="application-body">{children}</div>
      </div>
    </div>
  );
}
