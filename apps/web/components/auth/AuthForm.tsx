"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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
  const [error, setError] = useState(initialError ?? "");
  const [notice, setNotice] = useState(
    reset
      ? "Your password has been reset. Sign in with your new password."
      : verified
        ? "Your email is verified. You can sign in now."
        : "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isRegister = mode === "register";

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
      <a className="google-button" href={googleUrl}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.22c1.89-1.74 2.99-4.3 2.99-7.36Z" />
          <path fill="#34a853" d="M12 22c2.7 0 4.96-.89 6.61-2.41l-3.22-2.51c-.89.6-2.02.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.06v2.59A9.98 9.98 0 0 0 12 22Z" />
          <path fill="#fbbc05" d="M6.39 13.91a6.02 6.02 0 0 1 0-3.82V7.5H3.06a10 10 0 0 0 0 9l3.33-2.59Z" />
          <path fill="#ea4335" d="M12 5.96c1.47 0 2.79.51 3.83 1.51l2.87-2.87C16.96 2.97 14.7 2 12 2a9.98 9.98 0 0 0-8.94 5.5l3.33 2.59C7.18 7.72 9.39 5.96 12 5.96Z" />
        </svg>
        Continue with Google
      </a>
      <div className="auth-divider" aria-hidden="true"><span>or use email</span></div>
      <form className="auth-form" onSubmit={submit}>
        {isRegister ? (
          <label>
            <span>Your name</span>
            <input
              name="displayName"
              type="text"
              value={values.displayName}
              onChange={(event) => updateValue("displayName", event.target.value)}
              autoComplete="name"
              placeholder="Alex Morgan"
              required
            />
          </label>
        ) : null}
        <label>
          <span>Email address</span>
          <input
            name="email"
            type="email"
            value={values.email}
            onChange={(event) => updateValue("email", event.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </label>
        <label>
          <span>Password</span>
          <input
            name="password"
            type="password"
            value={values.password}
            onChange={(event) => updateValue("password", event.target.value)}
            autoComplete={isRegister ? "new-password" : "current-password"}
            placeholder="At least 8 characters"
            minLength={8}
            required
          />
        </label>
        {isRegister ? (
          <label>
            <span>Confirm password</span>
            <input
              name="confirmPassword"
              type="password"
              value={values.confirmPassword}
              onChange={(event) => updateValue("confirmPassword", event.target.value)}
              autoComplete="new-password"
              placeholder="Repeat your password"
              minLength={8}
              required
            />
          </label>
        ) : null}
        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Please wait…" : isRegister ? "Create account" : "Log in"}
        </button>
      </form>
      {!isRegister ? (
        <p className="auth-forgot">
          <a href="/forgot-password">Forgot password?</a>
        </p>
      ) : null}
      <p className="auth-switch">
        {isRegister ? "Already have an account?" : "New to LearnSpace?"}{" "}
        <a href={`${isRegister ? "/login" : "/register"}?next=${encodeURIComponent(next)}`}>
          {isRegister ? "Log in" : "Create an account"}
        </a>
      </p>
    </>
  );
}
