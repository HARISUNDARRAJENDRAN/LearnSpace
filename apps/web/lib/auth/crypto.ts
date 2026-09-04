import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export { hashPassword, verifyPassword } from "@learnspace/shared/password";

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashIpAddress(ipAddress: string, secret: string): string {
  return createHmac("sha256", secret).update(ipAddress).digest("hex");
}

export function safeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
