"use client";

import { MailCheck } from "lucide-react";
import { useState, type FormEvent } from "react";

type ResendResponse = {
  message?: string;
  verificationUrl?: string;
  error?: { message?: string };
};

export function VerifyEmailClient({
  email,
  next,
  developmentLink,
  status,
}: {
  email: string;
  next: string;
  developmentLink?: string;
  status?: string;
}) {
  const [address, setAddress] = useState(email);
  const [link, setLink] = useState(developmentLink ?? "");
  const [message, setMessage] = useState(
    status === "invalid"
      ? "That verification link is invalid or has expired."
      : status === "already-verified"
        ? "That email has already been verified."
        : status === "error"
          ? "We could not verify that link. Request a new one to continue."
        : "Check your inbox for a verification link.",
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address, next }),
      });
      const data = (await response.json()) as ResendResponse;
      if (!response.ok) {
        setError(data.error?.message ?? "We could not resend that email.");
        return;
      }
      setMessage(data.message ?? "If that account needs verification, a new email is on its way.");
      if (data.verificationUrl) {
        setLink(data.verificationUrl);
      }
    } catch {
      setError("The connection failed. Try again in a moment.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <span className="auth-verify-icon">
        <MailCheck aria-hidden="true" />
      </span>
      <p className="auth-verify-copy">{message}</p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      {link ? (
        <a className="development-link" href={link}>
          Open verification link
        </a>
      ) : null}
      <form className="auth-form" onSubmit={resend}>
        <div className="auth-field">
          <label htmlFor="verify-email">Email address</label>
          <input
            className="auth-input"
            id="verify-email"
            type="email"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Resend verification email"}
        </button>
      </form>
      <p className="auth-switch">
        Ready to continue? <a href={`/login?next=${encodeURIComponent(next)}`}>Go to login</a>
      </p>
    </>
  );
}
