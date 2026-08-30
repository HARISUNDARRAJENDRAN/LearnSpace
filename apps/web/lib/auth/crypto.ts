import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const passwordKeyLength = 64;
const passwordCost = 16_384;
const passwordBlockSize = 8;
const passwordParallelization = 1;

const verificationPayloadSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  next: z.string(),
  exp: z.number().int().positive(),
});

export type VerificationPayload = z.infer<typeof verificationPayloadSchema>;

function derivePasswordKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      passwordKeyLength,
      {
        N: passwordCost,
        r: passwordBlockSize,
        p: passwordParallelization,
        maxmem: 32 * 1024 * 1024,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = await derivePasswordKey(password, salt);

  return "scrypt$" + salt + "$" + derivedKey.toString("base64url");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parts = encodedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  const salt = parts[1];
  const expected = parts[2];
  if (!salt || !expected) {
    return false;
  }

  try {
    const derivedKey = await derivePasswordKey(password, salt);
    const expectedBuffer = Buffer.from(expected, "base64url");
    return (
      expectedBuffer.length === derivedKey.length &&
      timingSafeEqual(expectedBuffer, derivedKey)
    );
  } catch {
    return false;
  }
}

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

export function createVerificationToken(
  payload: VerificationPayload,
  secret: string,
): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
  return encodedPayload + "." + signature;
}

export function verifyVerificationToken(
  token: string,
  secret: string,
): VerificationPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
  if (!safeEqualText(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = verificationPayloadSchema.parse(
      JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
    );
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}
