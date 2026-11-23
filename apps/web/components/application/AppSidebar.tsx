"use client";

import {
  Brain,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Compass,
  House,
  LibraryBig,
  Plus,
  Search,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SidebarSessions } from "./SidebarSessions";

type NavigationMode = "learn" | "research";
type IconComponent = typeof House;

type ApplicationUser = {
  email: string;
  displayName: string | null;
};

type AppSidebarProps = {
  user: ApplicationUser;
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
  { label: "Discover", href: "/app/research/discover", icon: Compass, tone: "discover" },
] as const;

// Sessions leads this list as its own expandable tree (SidebarSessions).
const sharedNavigation = [
  { label: "Library", href: "/app/library", icon: LibraryBig, tone: "library" },
  { label: "Second Brain", href: "/app/second-brain", icon: Brain, tone: "brain" },
] as const;

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/app" || href === "/app/research") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isResearchPath(pathname: string): boolean {
  return pathname === "/app/research" || pathname.startsWith("/app/research/") || pathname.startsWith("/app/study/paper/");
}

/** The mode a URL belongs to: Research pages and paper sessions, and the Research views of Sessions and Library. */
export function modeFromUrl(pathname: string, searchParams: URLSearchParams): NavigationMode {
  if ((pathname === "/app/sessions" || pathname.startsWith("/app/sessions/folders/")) && searchParams.get("mode") === "research") return "research";
  if (pathname === "/app/library" && searchParams.get("view") === "papers") return "research";
  return isResearchPath(pathname) ? "research" : "learn";
}

export function AppSidebar({
  user,
  isOpen,
  isCollapsed,
  onClose,
  onOpenSearch,
  onToggleCollapsed,
}: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<NavigationMode>(() => modeFromUrl(pathname, searchParams));
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const firstName = user.displayName?.trim().split(/\s+/)[0] || "Learner";
  const modeNavigation = mode === "learn" ? learnNavigation : researchNavigation;

  // Research and Learn pages each belong to their mode (a concept in a research path opens Learn's Discover); the shared
  // pages (Sessions, Library, Second Brain, Settings) keep the mode the learner chose.
  useEffect(() => {
    if (isResearchPath(pathname)) setMode("research");
    else if (pathname === "/app" || pathname.startsWith("/app/discover") || pathname.startsWith("/app/study/")) setMode("learn");
    else if (pathname === "/app/sessions" || pathname.startsWith("/app/sessions/folders/")) setMode(modeFromUrl(pathname, searchParams));
  }, [pathname, searchParams]);

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

  // The sidebar is fixed beside the page; a wheel over it scrolls its own lists, never the page behind it.
  const sidebarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const onWheel = (event: WheelEvent) => {
      for (let node = event.target instanceof Element ? event.target : null; node && node !== sidebar; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return;
      }
      event.preventDefault();
    };
    sidebar.addEventListener("wheel", onWheel, { passive: false });
    return () => sidebar.removeEventListener("wheel", onWheel);
  }, []);

  function selectMode(nextMode: NavigationMode) {
    setMode(nextMode);
    setModeMenuOpen(false);
    if (pathname === "/app/sessions" || pathname.startsWith("/app/sessions/folders/")) {
      const params = new URLSearchParams(searchParams);
      if (nextMode === "research") params.set("mode", "research");
      else params.delete("mode");
      router.push(params.size ? `${pathname}?${params}` : pathname);
      return;
    }
    router.push(nextMode === "research" ? "/app/research" : "/app");
  }

  return (
    <>
      <button className={`application-backdrop ${isOpen ? "is-open" : ""}`} type="button" aria-label="Close navigation" onClick={onClose} />
      <aside ref={sidebarRef} className={`application-sidebar ${isOpen ? "is-open" : ""} ${isCollapsed ? "is-collapsed" : ""}`} aria-label="Application navigation">
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
              const active = isActivePath(pathname, href);
              return <NavLink key={`${mode}-${label}`} href={href} label={label} Icon={Icon} tone={tone} active={active} onClose={onClose} />;
            })}
          </div>
          <div className="application-nav-section">
            <p className="application-nav-label">WORKSPACE</p>
            <SidebarSessions mode={mode} onClose={onClose} />
            {sharedNavigation.map(({ label, href: defaultHref, icon: Icon, tone }) => {
              const href = label === "Library" && mode === "research" ? "/app/library?view=papers" : defaultHref;
              const active = label === "Library"
                ? isActivePath(pathname, "/app/library") && (mode === "research" ? searchParams.get("view") === "papers" : searchParams.get("view") !== "papers")
                : isActivePath(pathname, href);
              return <NavLink key={label} href={href} label={label} Icon={Icon} tone={tone} active={active} onClose={onClose} />;
            })}
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
