import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, shell } from "electron";

import { getAvailablePort } from "./free-port.js";
import { waitForServer } from "./server-ready.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const preloadPath = path.join(packageRoot, "dist", "preload.cjs");

const HEALTH_TIMEOUT_MS = 180_000;
const HEALTH_POLL_INTERVAL_MS = 500;

let runtimeProcess: ChildProcess | undefined;

function isLoopbackUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

function spawnDevServer(port: number): ChildProcess {
  const child = spawn(
    "pnpm",
    ["--filter", "@learnspace/web", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: repoRoot,
      stdio: "inherit",
      detached: true,
      env: { ...process.env, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1" },
    },
  );
  child.on("exit", (code, signal) => {
    if (runtimeProcess === child && code !== 0 && signal === null) {
      console.error(`LearnSpace dev server exited unexpectedly with code ${code}.`);
      app.exit(1);
    }
  });
  return child;
}

function stopRuntime(): void {
  if (runtimeProcess?.pid === undefined) {
    return;
  }
  const pid = runtimeProcess.pid;
  runtimeProcess = undefined;
  try {
    // The dev server runs as a process group (detached spawn); signal the whole
    // group so Next.js workers do not outlive the desktop shell.
    process.kill(-pid, "SIGTERM");
  } catch {
    // Already gone.
  }
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }, 5_000).unref();
}

function createWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isLoopbackUrl(target)) {
      return { action: "allow" };
    }
    if (target.startsWith("http:") || target.startsWith("https:")) {
      void shell.openExternal(target);
    }
    return { action: "deny" };
  });

  void window.loadURL(url);
  return window;
}

async function resolveAppUrl(): Promise<{ url: string; ownsRuntime: boolean }> {
  const attachUrl = process.env.LEARNSPACE_DESKTOP_SERVER_URL;
  if (attachUrl !== undefined && attachUrl !== "") {
    if (!isLoopbackUrl(attachUrl)) {
      throw new Error(
        `LEARNSPACE_DESKTOP_SERVER_URL must be an http(s) loopback URL, got: ${attachUrl}`,
      );
    }
    return { url: attachUrl, ownsRuntime: false };
  }

  const port = process.env.LEARNSPACE_DESKTOP_PORT
    ? Number(process.env.LEARNSPACE_DESKTOP_PORT)
    : await getAvailablePort();
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`LEARNSPACE_DESKTOP_PORT is not a valid port: ${port}`);
  }

  runtimeProcess = spawnDevServer(port);
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(`${url}/api/health`, {
    timeoutMs: HEALTH_TIMEOUT_MS,
    intervalMs: HEALTH_POLL_INTERVAL_MS,
  });
  return { url, ownsRuntime: true };
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window !== undefined) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.focus();
    }
  });

  void app.whenReady().then(async () => {
    try {
      const { url } = await resolveAppUrl();
      createWindow(url);
    } catch (error) {
      stopRuntime();
      console.error(error instanceof Error ? error.message : error);
      app.exit(1);
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    stopRuntime();
  });
}
