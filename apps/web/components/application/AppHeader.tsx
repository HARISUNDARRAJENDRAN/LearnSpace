"use client";

type ApplicationUser = {
  email: string;
  displayName: string | null;
};

export function AppHeader({ user, onMenu, onLogout, isLoggingOut }: { user: ApplicationUser; onMenu: () => void; onLogout: () => void; isLoggingOut: boolean }) {
  const firstName = user.displayName?.trim().split(/\s+/)[0] || "Learner";
  return (
    <header className="application-header">
      <button className="application-menu-button" type="button" onClick={onMenu} aria-label="Open navigation">
        <span /><span /><span />
      </button>
      <div className="application-header-context">
        <span className="application-header-kicker">LearnSpace</span>
        <span className="application-header-greeting">{firstName}&apos;s space</span>
      </div>
      <div className="application-account">
        <div className="application-avatar" aria-hidden="true">{firstName.slice(0, 1).toUpperCase()}</div>
        <span className="application-account-email">{user.email}</span>
        <button className="application-logout" type="button" onClick={onLogout} disabled={isLoggingOut}>{isLoggingOut ? "Signing out…" : "Log out"}</button>
      </div>
    </header>
  );
}
