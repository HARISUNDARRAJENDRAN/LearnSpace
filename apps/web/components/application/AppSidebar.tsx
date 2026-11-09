"use client";

import {
  Bookmark,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  FileSearch,
  House,
  Compass,
  LibraryBig,
  MoreHorizontal,
  Plus,
  Search,
  Video,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type NavigationMode = "learn" | "research";
type IconComponent = typeof House;

export type RecentSession = {
  id: string;
  title: string;
  mode: string;
  route: string | null;
  activeResource: { type: "video" | "paper" } | null;
};

type ApplicationUser = {
  email: string;
  displayName: string | null;
};

type AppSidebarProps = {
  user: ApplicationUser;
  recentSessions: RecentSession[];
  isOpen: boolean;
  isCollapsed: boolean;
  onClose: () => void;
  onOpenSearch: () => void;
  onToggleCollapsed: () => void;
};

const learnNavigation = [
  { label: "Home", href: "/app", icon: House, tone: "home" },
  { label: "Discover", href: "/app/discover", icon: Compass, tone: "discover" },
] as const;

const researchNavigation = [
  { label: "Research Home", href: "/app/research", icon: House, tone: "research" },
  { label: "Find Papers", href: "/app/research", icon: FileSearch, tone: "papers" },
  { label: "Saved Papers", href: "/app/library", icon: Bookmark, tone: "saved" },
] as const;

const sharedNavigation = [
  { label: "Sessions", href: "/app/sessions", icon: CalendarDays, tone: "sessions" },
  { label: "Library", href: "/app/library", icon: LibraryBig, tone: "library" },
  { label: "Second Brain", href: "/app/second-brain", icon: BrainCircuit, tone: "brain" },
] as const;

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === href;
  // Sessions opens the current study session, so it stays lit inside one.
  return pathname.startsWith(href) || (href === "/app/sessions" && pathname.startsWith("/app/study/"));
}

function modeFromPath(pathname: string): NavigationMode {
  return pathname.startsWith("/app/research") ? "research" : "learn";
}

function sessionIcon(session: RecentSession): IconComponent {
  return session.activeResource?.type === "video" ? Video : FileText;
}

export function AppSidebar({
  user,
  recentSessions,
  isOpen,
  isCollapsed,
  onClose,
  onOpenSearch,
  onToggleCollapsed,
}: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mode, setMode] = useState<NavigationMode>(() => modeFromPath(pathname));
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(true);
  const firstName = user.displayName?.trim().split(/\s+/)[0] || "Learner";
  const modeNavigation = mode === "learn" ? learnNavigation : researchNavigation;
  const visibleRecentSessions = useMemo(
    () => recentSessions.filter((session) => (mode === "research" ? session.mode === "research" : session.mode !== "research")).slice(0, 5),
    [mode, recentSessions],
  );

  useEffect(() => {
    if (pathname.startsWith("/app/research")) setMode("research");
  }, [pathname]);

  useEffect(() => {
    if (!modeMenuOpen) return;
    function closeMenus(event: MouseEvent) {
      const target = event.target as Node;
      if (!(target instanceof Element)) return;
      if (!target.closest(".application-mode-control")) setModeMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setModeMenuOpen(false);
    }
    document.addEventListener("click", closeMenus);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("click", closeMenus);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [modeMenuOpen]);

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
    }

    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenSearch();
        return;
      }
      if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        onOpenSearch();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [onOpenSearch]);

  function selectMode(nextMode: NavigationMode) {
    setMode(nextMode);
    setModeMenuOpen(false);
    router.push(nextMode === "research" ? "/app/research" : "/app");
  }

  return (
    <>
      <button className={`application-backdrop ${isOpen ? "is-open" : ""}`} type="button" aria-label="Close navigation" onClick={onClose} />
      <aside className={`application-sidebar ${isOpen ? "is-open" : ""} ${isCollapsed ? "is-collapsed" : ""}`} aria-label="Application navigation">
        <div className="application-workspace-row">
          <div className="application-workspace-identity">
            <span className="application-workspace-avatar" aria-hidden="true">{firstName.slice(0, 1).toUpperCase()}</span>
            <span className="application-workspace-name">{firstName}&apos;s Space</span>
            <ChevronDown className="application-workspace-chevron" aria-hidden="true" />
          </div>
          <span className="application-workspace-status" aria-hidden="true" />
          <button className="application-sidebar-collapse" type="button" aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={onToggleCollapsed}>
            {isCollapsed ? <ChevronsRight aria-hidden="true" /> : <ChevronsLeft aria-hidden="true" />}
          </button>
          <button className="application-close-nav" type="button" aria-label="Close navigation" onClick={onClose}>×</button>
        </div>

        <div className="application-control-row">
          <div className="application-mode-control">
            <button className="application-mode-trigger" type="button" aria-label={`Switch mode (currently ${mode})`} aria-haspopup="menu" aria-expanded={modeMenuOpen} onClick={() => setModeMenuOpen((open) => !open)}>
              {mode === "learn" ? <House aria-hidden="true" /> : <Search aria-hidden="true" />}
              <ChevronDown className="application-mode-trigger-chevron" aria-hidden="true" />
            </button>
            {modeMenuOpen ? (
              <div className="application-mode-menu" role="menu" aria-label="Switch mode">
                <p>Switch mode</p>
                <button type="button" role="menuitemradio" aria-checked={mode === "learn"} className={mode === "learn" ? "is-selected" : ""} onClick={() => selectMode("learn")}>
                  <House aria-hidden="true" />
                  <span>Learn</span>
                  {mode === "learn" ? <Check aria-hidden="true" /> : null}
                </button>
                <button type="button" role="menuitemradio" aria-checked={mode === "research"} className={mode === "research" ? "is-selected" : ""} onClick={() => selectMode("research")}>
                  <Search aria-hidden="true" />
                  <span>Research</span>
                  {mode === "research" ? <Check aria-hidden="true" /> : null}
                </button>
              </div>
            ) : null}
          </div>
          <Link className="application-new-session" href={mode === "research" ? "/app/research" : "/app/discover"} onClick={onClose}>
            <span className="application-new-session-content">
              <Plus aria-hidden="true" />
              <span>{mode === "research" ? "New research" : "New session"}</span>
            </span>
          </Link>
          <button className="application-search-button" type="button" aria-label="Search LearnSpace" title="Search (⌘K)" onClick={onOpenSearch}>
            <Search aria-hidden="true" />
          </button>
        </div>

        <nav className="application-nav">
          <div className="application-nav-section">
            <p className="application-nav-label">{mode === "research" ? "RESEARCH" : "LEARN"}</p>
            {modeNavigation.map(({ label, href, icon: Icon, tone }) => {
              const active = isActivePath(pathname, href) && !(mode === "research" && label === "Find Papers");
              return <NavLink key={`${mode}-${label}`} href={href} label={label} Icon={Icon} tone={tone} active={active} onClose={onClose} />;
            })}
          </div>
          <div className="application-nav-section">
            <p className="application-nav-label">WORKSPACE</p>
            {sharedNavigation.map(({ label, href, icon: Icon, tone }) => {
              const active = isActivePath(pathname, href) && !(mode === "research" && label === "Library");
              return <NavLink key={href} href={href} label={label} Icon={Icon} tone={tone} active={active} onClose={onClose} />;
            })}
          </div>
          <div className={`application-recent-section ${recentOpen ? "is-open" : ""}`}>
            <button className="application-nav-section-heading" type="button" aria-expanded={recentOpen} onClick={() => setRecentOpen((open) => !open)}>
              <span>RECENT {mode === "research" ? "RESEARCH" : "CONTEXT"}</span>
              <span className="application-nav-section-actions"><MoreHorizontal aria-hidden="true" /><ChevronDown aria-hidden="true" /></span>
            </button>
            {recentOpen ? (
              <div className="application-recent-list">
                {visibleRecentSessions.length > 0 ? visibleRecentSessions.map((session) => {
                  const Icon = sessionIcon(session);
                  return <Link className="application-recent-link" data-nav-tone={session.activeResource?.type ?? "session"} href={session.route ?? "/app/sessions"} key={session.id} onClick={onClose}><span className="application-nav-icon" aria-hidden="true"><Icon /></span><span>{session.title}</span></Link>;
                }) : <p className="application-recent-empty">No recent {mode === "research" ? "research" : "sessions"} yet.</p>}
              </div>
            ) : null}
          </div>
        </nav>

        <div className="application-sidebar-footer">
          <Link className={`application-profile-link ${isActivePath(pathname, "/app/profile") ? "is-active" : ""}`} href="/app/profile" aria-current={isActivePath(pathname, "/app/profile") ? "page" : undefined} aria-label="My profile" title="My profile" onClick={onClose}>
            <span className="application-profile-avatar" aria-hidden="true">{firstName.slice(0, 1).toUpperCase()}</span>
            <span className="application-profile-copy"><b>{user.displayName?.trim() || firstName}</b><small>{user.email}</small></span>
          </Link>
        </div>
      </aside>
    </>
  );
}

function NavLink({ href, label, Icon, tone, active, onClose }: { href: string; label: string; Icon: IconComponent; tone: string; active: boolean; onClose: () => void }) {
  return <Link className={`application-nav-link ${active ? "is-active" : ""}`} data-nav-tone={tone} href={href} aria-current={active ? "page" : undefined} onClick={onClose}><span className="application-nav-icon" aria-hidden="true"><Icon /></span><span>{label}</span></Link>;
}
