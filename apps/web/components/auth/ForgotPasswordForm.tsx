"use client";

import { useState, type FormEvent } from "react";

type ForgotResponse = {
  message?: string;
  resetUrl?: string;
  error?: { message?: string };
};

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resetUrl, setResetUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setResetUrl("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as ForgotResponse;
      if (!response.ok) {
        setError(data.error?.message ?? "We could not process that request.");
        return;
      }
      setMessage(data.message ?? "If an account matches that email, a reset link is on its way.");
      setResetUrl(data.resetUrl ?? "");
    } catch {
      setError("The connection failed. Try again in a moment.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {message ? <p className="auth-notice" role="status">{message}</p> : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {resetUrl ? (
        <a className="development-link" href={resetUrl}>
          Open password reset link
        </a>
      ) : null}
      <form className="auth-form" onSubmit={submit}>
        <div className="auth-field">
          <label htmlFor="forgot-email">Email address</label>
          <input
            className="auth-input"
            id="forgot-email"
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </div>
        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p className="auth-switch">
        Remembered it? <a href="/login">Go to login</a>
      </p>
    </>
  );
}
