import { closeDb } from "@learnspace/db";
import { hashPassword, verifyPassword } from "@learnspace/shared/password";
import {
  consumeEmailVerificationChallenge,
  createAuthChallenge,
  createEmailUser,
} from "../lib/auth/repository";

const email = process.env.MANUAL_E2E_EMAIL;
const password = process.env.MANUAL_E2E_PASSWORD;

if (!email || !password) {
  throw new Error("MANUAL_E2E_EMAIL and MANUAL_E2E_PASSWORD are required.");
}

try {
  const passwordHash = await hashPassword(password);
  if (!(await verifyPassword(password, passwordHash))) {
    throw new Error("The local E2E password self-check failed.");
  }

  const user = await createEmailUser({
    email,
    displayName: "Local E2E Learner",
    passwordHash,
  });
  const token = await createAuthChallenge(
    user.id,
    "email_verification",
    new Date(Date.now() + 60 * 60 * 1000),
  );
  const verification = await consumeEmailVerificationChallenge(token);

  if (!verification?.user.emailVerified) {
    throw new Error("The local E2E account could not be verified.");
  }

  console.log(`Prepared local E2E account: ${email}`);
} finally {
  await closeDb();
}
