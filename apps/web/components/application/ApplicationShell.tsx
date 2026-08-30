"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LearnSpaceLogo } from "../marketing/hero/LearnSpaceLogo";

type ApplicationUser = {
  id: string;
  email: string;
  displayName: string | null;
  subscriptionTier: string;
};

export function ApplicationShell({ user }: { user: ApplicationUser }) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const firstName = user.displayName?.split(" ")[0] || "learner";

  async function logout() {
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/");
      router.refresh();
    }
  }

  return (
    <main className="application-page">
      <header className="application-header">
        <a className="application-brand" href="/" aria-label="LearnSpace home">
          <LearnSpaceLogo />
        </a>
        <div className="application-account">
          <div className="application-avatar" aria-hidden="true">
            {firstName.slice(0, 1).toUpperCase()}
          </div>
          <span>{user.email}</span>
          <button type="button" onClick={logout} disabled={isLoggingOut}>
            {isLoggingOut ? "Signing out…" : "Log out"}
          </button>
        </div>
      </header>
      <section className="application-content">
        <div className="application-intro">
          <p className="application-eyebrow">Your learning space</p>
          <h1>Welcome back, {firstName}.</h1>
          <p>Pick up where you left off, or make space for a new idea.</p>
        </div>
        <div className="application-grid">
          <article className="application-card application-card-focus">
            <span className="application-card-label">Today&apos;s focus</span>
            <h2>Build a memory that lasts.</h2>
            <p>Review your active learning path and keep your next idea close.</p>
            <button type="button">Open focus session <span aria-hidden="true">↗</span></button>
          </article>
          <article className="application-card">
            <span className="application-card-label">Review queue</span>
            <strong className="application-stat">12</strong>
            <p>notes ready for a thoughtful review</p>
            <div className="application-progress"><span /></div>
          </article>
          <article className="application-card">
            <span className="application-card-label">Learning map</span>
            <strong>Distributed systems</strong>
            <p>3 connected concepts are waiting for your attention.</p>
            <a href="#learning-map">View map <span aria-hidden="true">↗</span></a>
          </article>
        </div>
        <section className="application-recent" id="learning-map">
          <div>
            <span className="application-card-label">Recent notes</span>
            <h2>Keep the thread going.</h2>
          </div>
          <div className="application-note-list">
            <a href="#recent-notes"><span>01</span> Active recall and retrieval</a>
            <a href="#recent-notes"><span>02</span> Designing a research habit</a>
            <a href="#recent-notes"><span>03</span> Spaced repetition notes</a>
          </div>
        </section>
      </section>
    </main>
  );
}
