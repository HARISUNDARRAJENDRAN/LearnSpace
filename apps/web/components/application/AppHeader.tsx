"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";

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
  return (
    <header className="application-header">
      <button className="application-menu-button" type="button" onClick={onMenu} aria-label="Open navigation">
        <Menu aria-hidden="true" />
      </button>
      <div className="application-header-context">
        <span className="application-header-title">{contextLabel(pathname)}</span>
      </div>
    </header>
  );
}
