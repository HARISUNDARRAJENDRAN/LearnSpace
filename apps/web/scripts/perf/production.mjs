import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Reuse local Docker credentials without printing or persisting secrets. Never inherit remote databases/KV.
const configuration = JSON.parse(execFileSync("docker", ["inspect", "learnspace-web-1"], { encoding: "utf8" }))[0];
const env = { ...process.env, ...Object.fromEntries(configuration.Config.Env.map((entry) => {
  const at = entry.indexOf("=");
  return [entry.slice(0, at), entry.slice(at + 1)];
})) };
for (const key of Object.keys(env).filter((key) => key.startsWith("DATABASE_") && env[key])) {
  const url = new URL(env[key]);
  if (!["postgres", "localhost", "127.0.0.1"].includes(url.hostname)) throw new Error(`Refusing remote ${key}`);
  url.hostname = "127.0.0.1";
  url.port = "55432";
  env[key] = url.href;
}
for (const key of Object.keys(env).filter((key) => key.startsWith("KV_"))) env[key] = "";
Object.assign(env, { NODE_OPTIONS: "--max-old-space-size=3072", NEXT_DIST_DIR: ".next-perf", APP_URL: "http://localhost:3100", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" });
const args = process.argv.slice(2);
const next = fileURLToPath(new URL("../../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(args[0] === "exec" ? args[1] : process.execPath, args[0] === "exec" ? args.slice(2) : [next, ...(args[0] === "build" ? ["build", ...args.slice(1)] : ["start", "--hostname", "127.0.0.1", "-p", "3100"])], { cwd: fileURLToPath(new URL("../../", import.meta.url)), env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
