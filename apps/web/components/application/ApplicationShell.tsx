"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";

type ApplicationUser = {
  email: string;
  displayName: string | null;
};

export function ApplicationShell({ user, children }: { user: ApplicationUser; children: ReactNode }) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    <div className="application-page">
      <AppSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="application-main">
        <AppHeader user={user} onMenu={() => setSidebarOpen(true)} onLogout={logout} isLoggingOut={isLoggingOut} />
        <div className="application-body">{children}</div>
      </div>
    </div>
  );
}
