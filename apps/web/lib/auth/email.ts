import { AuthError } from "./errors";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendVerificationEmail(input: {
  email: string;
  displayName: string;
  verificationUrl: string;
}): Promise<{ verificationUrl?: string }> {
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
      }),
    });

    if (!response.ok) {
      throw new AuthError(
        "EMAIL_DELIVERY_FAILED",
        "We could not send the verification email. Please try again.",
        502,
      );
    }

    return {};
  }

  if (process.env.NODE_ENV === "production") {
    throw new AuthError(
      "EMAIL_NOT_CONFIGURED",
      "Email delivery is not configured on this server.",
      503,
    );
  }

  console.info("[auth] development verification URL: " + input.verificationUrl);
  return process.env.AUTH_EXPOSE_VERIFICATION_LINK === "false"
    ? {}
    : { verificationUrl: input.verificationUrl };
}
