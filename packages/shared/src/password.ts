import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const passwordKeyLength = 64;
const passwordCost = 16_384;
const passwordBlockSize = 8;
const passwordParallelization = 1;

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

  return `scrypt$${salt}$${derivedKey.toString("base64url")}`;
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parts = encodedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const salt = parts[1];
  const expected = parts[2];
  if (!salt || !expected) return false;

  try {
    const derivedKey = await derivePasswordKey(password, salt);
    const expectedBuffer = Buffer.from(expected, "base64url");
    return (
      expectedBuffer.length === derivedKey.length
      && timingSafeEqual(expectedBuffer, derivedKey)
    );
  } catch {
    return false;
  }
}
