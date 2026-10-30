import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { safeRedirectPath } from "./validation";

// Google refuses OAuth inside embedded app windows, so the desktop app signs in
// through the system browser and receives the new session over this link.
export const desktopCallbackUrl = "learnspace://auth";
const handoffLifetimeMs = 60_000;
const desktopNoncePattern = /^[A-Za-z0-9_-]{22,128}$/;

const handoffSchema = z.object({
  token: z.string().min(1),
  maxAge: z.number().int().positive(),
  destination: z.string(),
  expiresAt: z.number(),
});

export type DesktopHandoff = { token: string; maxAge: number; destination: string };

export function parseDesktopNonce(value: string | null): string {
  return value && desktopNoncePattern.test(value) ? value : "";
}

function handoffKey(secret: string): Buffer {
  return createHash("sha256").update(`learnspace-desktop-handoff:${secret}`).digest();
}

// Encrypted, not just signed: the link must not reveal the session token.
export function sealDesktopHandoff(handoff: DesktopHandoff, secret: string, now = Date.now()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", handoffKey(secret), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify({ ...handoff, expiresAt: now + handoffLifetimeMs })),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function openDesktopHandoff(code: string, secret: string, now = Date.now()): DesktopHandoff | null {
  try {
    const raw = Buffer.from(code, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", handoffKey(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const handoff = handoffSchema.parse(JSON.parse(plain));
    if (handoff.expiresAt < now) return null;
    return {
      token: handoff.token,
      maxAge: handoff.maxAge,
      destination: safeRedirectPath(handoff.destination),
    };
  } catch {
    return null;
  }
}
