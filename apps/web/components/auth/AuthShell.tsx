import type { ReactNode } from "react";
import { LearnSpaceLogo } from "../marketing/hero/LearnSpaceLogo";

export function AuthShell({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <main className="auth-page">
      <div className="auth-glow auth-glow-left" aria-hidden="true" />
      <div className="auth-glow auth-glow-right" aria-hidden="true" />
      <div className="auth-layout">
        <header className="auth-header">
          <a className="auth-logo" href="/" aria-label="LearnSpace home">
            <LearnSpaceLogo />
          </a>
          <a className="auth-home-link" href="/">
            Back to home
          </a>
        </header>
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-card-heading">
            <p className="auth-eyebrow">LearnSpace</p>
            <h1 id="auth-title">{title}</h1>
            <p>{subtitle}</p>
          </div>
          {children}
        </section>
        <p className="auth-legal">
          By continuing, you agree to use LearnSpace for thoughtful, focused learning.
        </p>
      </div>
    </main>
  );
}
