"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type AuthFormMode = "login" | "register";

type AuthResponse = {
  ok?: boolean;
  redirectTo?: string;
  verificationUrl?: string;
  message?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

function errorMessage(response: AuthResponse): string {
  return response.error?.message ?? "We could not complete that request.";
}

const initialValues = {
  displayName: "",
  email: "",
  password: "",
  confirmPassword: "",
};

export function AuthForm({
  mode,
  next,
  initialError,
  verified,
  reset,
}: {
  mode: AuthFormMode;
  next: string;
  initialError?: string;
  verified?: boolean;
  reset?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const isRegister = mode === "register";
  const [error, setError] = useState(initialError ?? "");
  const [notice, setNotice] = useState(
    reset
      ? "Your password has been reset. Sign in with your new password."
      : verified
        ? "Your email is verified. You can sign in now."
        : "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateValue(field: keyof typeof initialValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (isRegister && values.password !== values.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/auth/${isRegister ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isRegister ? { displayName: values.displayName } : {}),
          email: values.email,
          password: values.password,
          next,
        }),
      });
      const data = (await response.json()) as AuthResponse;

      if (!response.ok) {
        setError(errorMessage(data));
        return;
      }

      if (isRegister) {
        if (data.verificationUrl && process.env.NEXT_PUBLIC_MANUAL_E2E_MODE === "true") {
          const verificationUrl = new URL(data.verificationUrl, window.location.origin);
          if (
            verificationUrl.origin !== window.location.origin ||
            verificationUrl.pathname !== "/api/auth/verify"
          ) {
            setError("We could not start email verification.");
            return;
          }
          window.location.replace(verificationUrl.href);
          return;
        }

        const verifyUrl = new URL("/verify-email", window.location.origin);
        verifyUrl.searchParams.set("email", values.email);
        verifyUrl.searchParams.set("next", next);
        if (data.verificationUrl) {
          verifyUrl.searchParams.set("devLink", data.verificationUrl);
        }
        router.push(verifyUrl.pathname + verifyUrl.search);
        return;
      }

      router.replace(data.redirectTo ?? "/app");
      router.refresh();
    } catch {
      setError("The connection failed. Check your network and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const googleUrl = `/api/auth/google?next=${encodeURIComponent(next)}`;

  return (
    <>
      {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
      {error ? (
        <div className="auth-error" role="alert">
          <p>{error}</p>
          {isRegister === false && error === "Verify your email before logging in." ? (
            <a
              href={`/verify-email?email=${encodeURIComponent(values.email)}&next=${encodeURIComponent(next)}`}
            >
              Resend verification email
            </a>
          ) : null}
        </div>
      ) : null}
      <a className="auth-google" href={googleUrl}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M12.479 14.265v-3.279h11.049c.108.571.164 1.247.164 1.979 0 2.46-.672 5.502-2.84 7.669C18.744 22.829 16.051 24 12.483 24 5.869 24 .308 18.613.308 12S5.869 0 12.483 0c3.659 0 6.265 1.436 8.223 3.307L18.392 5.62c-1.404-1.317-3.307-2.341-5.913-2.341C7.65 3.279 3.873 7.171 3.873 12s3.777 8.721 8.606 8.721c3.132 0 4.916-1.258 6.059-2.401.927-.927 1.537-2.251 1.777-4.059l-7.836.004Z" />
        </svg>
        Continue with Google
      </a>
      <div className="auth-divider" aria-hidden="true">
        <span>or</span>
      </div>
      <form className="auth-form" onSubmit={submit}>
        {isRegister ? (
          <div className="auth-field">
            <label htmlFor="display-name">Your name</label>
            <input
              className="auth-input"
              id="display-name"
              name="displayName"
              type="text"
              value={values.displayName}
              onChange={(event) => updateValue("displayName", event.target.value)}
              autoComplete="name"
              placeholder="Alex Morgan"
              required
            />
          </div>
        ) : null}
        <div className="auth-field">
          <label htmlFor="auth-email">Email address</label>
          <input
            className="auth-input"
            id="auth-email"
            name="email"
            type="email"
            value={values.email}
            onChange={(event) => updateValue("email", event.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </div>
        <div className="auth-field">
          <div className="auth-label-row">
            <label htmlFor="auth-password">Password</label>
            {isRegister ? null : <a href="/forgot-password">Forgot password?</a>}
          </div>
          <input
            className="auth-input"
            id="auth-password"
            name="password"
            type="password"
            value={values.password}
            onChange={(event) => updateValue("password", event.target.value)}
            autoComplete={isRegister ? "new-password" : "current-password"}
            placeholder="At least 8 characters"
            minLength={8}
            required
          />
        </div>
        {isRegister ? (
          <div className="auth-field">
            <label htmlFor="confirm-password">Confirm password</label>
            <input
              className="auth-input"
              id="confirm-password"
              name="confirmPassword"
              type="password"
              value={values.confirmPassword}
              onChange={(event) => updateValue("confirmPassword", event.target.value)}
              autoComplete="new-password"
              placeholder="Repeat your password"
              minLength={8}
              required
            />
          </div>
        ) : null}
        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Please wait…" : isRegister ? "Create account" : "Log in"}
        </button>
      </form>
      <p className="auth-switch">
        {isRegister ? "Already have an account?" : "New to LearnSpace?"}{" "}
        <a href={`${isRegister ? "/login" : "/register"}?next=${encodeURIComponent(next)}`}>
          {isRegister ? "Log in" : "Create an account"}
        </a>
      </p>
    </>
  );
}
