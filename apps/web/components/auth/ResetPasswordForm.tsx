"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type ResetResponse = { redirectTo?: string; error?: { message?: string } };

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(token ? "" : "This reset link is invalid or has expired.");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token) {
      setError("This reset link is invalid or has expired.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await response.json()) as ResetResponse;
      if (!response.ok) {
        setError(data.error?.message ?? "This reset link is invalid or has expired.");
        return;
      }
      router.replace(data.redirectTo ?? "/login?reset=1");
    } catch {
      setError("The connection failed. Try again in a moment.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <form className="auth-form" onSubmit={submit}>
        <label>
          <span>New password</span>
          <input
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            minLength={8}
            required
          />
        </label>
        <label>
          <span>Confirm password</span>
          <input
            name="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="Repeat your password"
            minLength={8}
            required
          />
        </label>
        <button className="auth-submit" type="submit" disabled={isSubmitting || !token}>
          {isSubmitting ? "Updating…" : "Reset password"}
        </button>
      </form>
      <p className="auth-switch">
        Need a new link? <a href="/forgot-password">Start again</a>
      </p>
    </>
  );
}
