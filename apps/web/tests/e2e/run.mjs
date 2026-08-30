import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const runId = `${Date.now()}-${process.pid}`;
const child = spawn(command, ["exec", "playwright", "test", ...process.argv.slice(2)], {
  env: { ...process.env, PLAYWRIGHT_RUN_ID: runId },
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
