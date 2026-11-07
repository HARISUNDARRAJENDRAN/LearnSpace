import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = "learnspace-manual-e2e";
const composeArgs = ["compose", "--project-name", project];
const e2eEnv = {
  ...process.env,
  POSTGRES_PORT: "127.0.0.1:55433",
  DATABASE_ADMIN_URL: "postgres://postgres:postgres@127.0.0.1:55433/learnspace",
  DATABASE_MIGRATOR_URL: "postgres://learnspace_migrator:learnspace_migrator@127.0.0.1:55433/learnspace",
  DATABASE_URL: "postgres://learnspace_app:learnspace_app@127.0.0.1:55433/learnspace",
  DATABASE_AUTH_URL: "postgres://learnspace_auth:learnspace_auth@127.0.0.1:55433/learnspace",
  DATABASE_WORKER_URL: "postgres://learnspace_worker:learnspace_worker@127.0.0.1:55433/learnspace",
  APP_URL: "http://localhost:3101",
  AUTH_SECRET: "local-manual-e2e-secret-not-for-production",
  AUTH_SECURE_COOKIES: "false",
  AUTH_EXPOSE_VERIFICATION_LINK: "true",
  AUTH_TEST_MODE: "false",
  NEXT_PUBLIC_MANUAL_E2E_MODE: "true",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  GOOGLE_REDIRECT_URI: "",
  RESEND_API_KEY: "",
  EMAIL_FROM: "",
  KV_URL: "",
  KV_REST_API_URL: "",
  KV_REST_API_TOKEN: "",
  KV_REST_API_READ_ONLY_TOKEN: "",
  EXA_API_KEY: "",
  OPENAI_API_KEY: "",
  NEXT_TELEMETRY_DISABLED: "1",
  MANUAL_E2E_EMAIL: "manual-e2e@example.test",
  MANUAL_E2E_PASSWORD: "local-e2e-only-password",
};

const databaseUrl = new URL(e2eEnv.DATABASE_ADMIN_URL);
if (
  !["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname) ||
  databaseUrl.port !== "55433" ||
  databaseUrl.pathname !== "/learnspace"
) {
  throw new Error("Manual E2E may only reset its dedicated local database.");
}

let activeChild;
let databaseStarted = false;
let shutdownSignal;

function run(command, args, env = e2eEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    activeChild = child;
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (activeChild === child) activeChild = undefined;
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdownSignal = signal;
    activeChild?.kill(signal);
  });
}

try {
  databaseStarted = true;
  await run("docker", [...composeArgs, "up", "-d", "--wait", "postgres"]);
  await run("pnpm", ["db:reset:local"]);
  await run("pnpm", ["--filter", "@learnspace/shared", "build"]);
  await run("pnpm", ["--filter", "@learnspace/db", "build"]);
  await run("pnpm", ["db:migrate"]);
  await run("pnpm", ["db:verify"]);
  await run("pnpm", ["db:seed:dev"]);
  await run("pnpm", ["--filter", "@learnspace/web", "exec", "tsx", "scripts/seed-manual-e2e-user.ts"]);

  console.log("\nManual E2E is ready at http://localhost:3101/login");
  console.log(`Email: ${e2eEnv.MANUAL_E2E_EMAIL}`);
  console.log(`Password: ${e2eEnv.MANUAL_E2E_PASSWORD}`);
  console.log("Press Ctrl+C to stop and delete the local E2E database.\n");

  const server = spawn(
    "pnpm",
    ["--filter", "@learnspace/web", "exec", "next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3101"],
    { cwd: root, env: e2eEnv, stdio: "inherit" },
  );
  activeChild = server;
  const exitCode = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  if (shutdownSignal) process.exitCode = 0;
  else process.exitCode = exitCode;
} catch (error) {
  if (shutdownSignal) process.exitCode = 0;
  else {
    console.error(error);
    process.exitCode = 1;
  }
} finally {
  if (activeChild) {
    activeChild.kill("SIGTERM");
    activeChild = undefined;
  }
  if (databaseStarted) {
    try {
      await run("docker", [...composeArgs, "down", "-v"]);
    } catch (error) {
      console.error("Could not remove the disposable E2E database:", error);
      process.exitCode = 1;
    }
  }
}
