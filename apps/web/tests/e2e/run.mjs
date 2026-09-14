import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const runId = `${Date.now()}-${process.pid}`;
const production = process.argv.includes("--production");
const playwrightArgs = process.argv
  .slice(2)
  .filter((argument) => argument !== "--production" && argument !== "--");
const child = spawn(command, ["exec", "playwright", "test", ...playwrightArgs], {
  env: {
    ...process.env,
    PLAYWRIGHT_RUN_ID: runId,
    ...(production ? { PLAYWRIGHT_E2E_SERVER: "production" } : {}),
  },
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.once("error", (error) => {
  console.error(error);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
