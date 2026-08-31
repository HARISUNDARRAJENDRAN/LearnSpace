"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LearnSpaceLogo } from "../marketing/hero/LearnSpaceLogo";

const navigation = [
  ["Home", "/app", "home"],
  ["Discover", "/app/discover", "discover"],
  ["Sessions", "/app/sessions", "sessions"],
  ["Library", "/app/library", "library"],
  ["Research", "/app/research", "research"],
  ["Second Brain", "/app/second-brain", "brain"],
  ["Settings", "/app/settings", "settings"],
] as const;

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: "M3 10.5 12 3l9 7.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z M9 20v-5h6v5",
    discover: "m21 3-8.2 8.2M21 3l-5.4 15.1-2.8-6.9-6.9-2.8z",
    sessions: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M7 8h10M7 12h6M7 16h8",
    library: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z M4 5.5v16M8 7h8",
    research: "M10.5 18a7.5 7.5 0 1 1 5.3-2.2L21 21 M10.5 13a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z",
    brain: "M9 4.5A3 3 0 0 0 6 7.4 3 3 0 0 0 6.7 13 3.5 3.5 0 0 0 9 19.5M15 4.5a3 3 0 0 1 3 2.9 3 3 0 0 1-.7 5.6 3.5 3.5 0 0 1-2.3 6.5M9 4.5v15M15 4.5v15M9 9h6M9 14h6",
    settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.6v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H4.4v-2.6h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h2.6v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1z",
  };
  return <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function AppSidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();
  return (
    <>
      <button className={`application-backdrop ${isOpen ? "is-open" : ""}`} type="button" aria-label="Close navigation" onClick={onClose} />
      <aside className={`application-sidebar ${isOpen ? "is-open" : ""}`} aria-label="Application navigation">
        <div className="application-sidebar-top">
          <Link className="application-sidebar-brand" href="/" aria-label="LearnSpace home" onClick={onClose}>
            <LearnSpaceLogo />
          </Link>
          <button className="application-close-nav" type="button" aria-label="Close navigation" onClick={onClose}>×</button>
        </div>
        <nav className="application-nav">
          {navigation.map(([label, href, icon]) => {
            const active = href === "/app" ? pathname === href : pathname.startsWith(href);
            return (
              <Link className={`application-nav-link ${active ? "is-active" : ""}`} href={href} key={href} aria-current={active ? "page" : undefined} onClick={onClose}>
                <Icon name={icon} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="application-sidebar-note">
          <span className="application-sidebar-note-dot" />
          <span>Your space to learn</span>
        </div>
      </aside>
    </>
  );
}
