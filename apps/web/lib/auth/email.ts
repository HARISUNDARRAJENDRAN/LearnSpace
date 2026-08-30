import { AuthError } from "./errors";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function deliverEmail(input: {
  email: string;
  subject: string;
  text: string;
  html: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (apiKey && from) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.email],
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    });

    if (!response.ok) {
      throw new AuthError(
        "EMAIL_DELIVERY_FAILED",
        "We could not send the verification email. Please try again.",
        502,
      );
    }

    return true;
  }

  if (process.env.NODE_ENV === "production") {
    throw new AuthError(
      "EMAIL_NOT_CONFIGURED",
      "Email delivery is not configured on this server.",
      503,
    );
  }

  return false;
}

function exposeDevelopmentLink(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.AUTH_EXPOSE_VERIFICATION_LINK !== "false";
}

export async function sendVerificationEmail(input: {
  email: string;
  displayName: string;
  verificationUrl: string;
}): Promise<{ verificationUrl?: string }> {
  const delivered = await deliverEmail({
    email: input.email,
    subject: "Verify your LearnSpace email",
    text:
      "Hi " +
      input.displayName +
      ",\n\nVerify your LearnSpace email here:\n" +
      input.verificationUrl,
    html:
      "<p>Hi " +
      escapeHtml(input.displayName) +
      ",</p><p>Verify your LearnSpace email to start learning.</p><p><a href=\"" +
      escapeHtml(input.verificationUrl) +
      "\">Verify email</a></p>",
  });

  return delivered || !exposeDevelopmentLink()
    ? {}
    : { verificationUrl: input.verificationUrl };
}

export async function sendPasswordResetEmail(input: {
  email: string;
  displayName: string;
  resetUrl: string;
}): Promise<{ resetUrl?: string }> {
  const delivered = await deliverEmail({
    email: input.email,
    subject: "Reset your LearnSpace password",
    text:
      "Hi " +
      input.displayName +
      ",\n\nReset your LearnSpace password here:\n" +
      input.resetUrl,
    html:
      "<p>Hi " +
      escapeHtml(input.displayName) +
      ",</p><p>Reset your LearnSpace password using this link.</p><p><a href=\"" +
      escapeHtml(input.resetUrl) +
      "\">Reset password</a></p>",
  });

  return delivered || !exposeDevelopmentLink() ? {} : { resetUrl: input.resetUrl };
}
