import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, session, shell } from "electron";

import { buildRuntimeEnv } from "./config.js";
import { getAvailablePort } from "./free-port.js";
import { classifyLaunchMode } from "./launch-mode.js";
import { waitForServer } from "./server-ready.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const preloadPath = path.join(packageRoot, "dist", "preload.cjs");

const HEALTH_TIMEOUT_MS = 180_000;
const HEALTH_POLL_INTERVAL_MS = 500;

const DESKTOP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://i.ytimg.com https://*.ytimg.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob: https:",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

let runtimeProcess: ChildProcess | undefined;
let runtimeLogFile: string | undefined;

function resolveRuntimeDir(): string {
  const override = process.env.LEARNSPACE_DESKTOP_RUNTIME_DIR;
  if (override !== undefined && override !== "") {
    return override;
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "runtime");
  }
  throw new Error("No runtime directory configured.");
}

async function openRuntimeLog(): Promise<NodeJS.WritableStream> {
  const logDir = path.join(app.getPath("userData"), "logs");
  await mkdir(logDir, { recursive: true });
  runtimeLogFile = path.join(logDir, "runtime.log");
  return createWriteStream(runtimeLogFile, { flags: "a" });
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
      fail(`LearnSpace dev server exited unexpectedly with code ${code}.`);
    }
  });
  return child;
}

async function spawnPackagedRuntime(port: number): Promise<ChildProcess> {
  const runtimeDir = resolveRuntimeDir();
  const serverJs = path.join(runtimeDir, "apps", "web", "server.js");
  try {
    await access(serverJs);
  } catch {
    throw new Error(
      `Bundled LearnSpace runtime is missing (${serverJs}). ` +
        "Rebuild the desktop package with `pnpm desktop:build`.",
    );
  }

  const env = await buildRuntimeEnv({
    port,
    userDataDir: app.getPath("userData"),
  });
  const log = await openRuntimeLog();

  const child = spawn(process.execPath, [serverJs], {
    cwd: path.dirname(serverJs),
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  child.on("exit", (code, signal) => {
    if (runtimeProcess === child && signal === null && code !== 0) {
      fail(
        `The bundled LearnSpace runtime exited unexpectedly (code ${code}).` +
          (runtimeLogFile !== undefined ? `\nSee ${runtimeLogFile}` : ""),
      );
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

function fail(message: string): never {
  stopRuntime();
  dialog.showErrorBox("LearnSpace could not start", message);
  app.exit(1);
  throw new Error(message);
}

function applySecurityPolicy(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith("http://127.0.0.1") || details.url.startsWith("http://localhost")) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [DESKTOP_CSP],
        },
      });
      return;
    }
    callback({ responseHeaders: details.responseHeaders ?? {} });
  });
}

function createWindow(url: string): BrowserWindow {
  const appOrigin = new URL(url).origin;

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
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith(appOrigin)) {
      return { action: "allow" };
    }
    if (target.startsWith("https:")) {
      void shell.openExternal(target);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, target) => {
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      event.preventDefault();
      return;
    }
    if (parsed.origin === appOrigin) {
      return;
    }
    event.preventDefault();
    if (parsed.protocol === "https:") {
      void shell.openExternal(target);
    }
  });

  void window.loadURL(url);
  return window;
}

async function resolveAppUrl(): Promise<{ url: string }> {
  const mode = classifyLaunchMode({
    attachUrl: process.env.LEARNSPACE_DESKTOP_SERVER_URL,
    isPackaged: app.isPackaged,
    runtimeDirOverride: process.env.LEARNSPACE_DESKTOP_RUNTIME_DIR,
  });

  if (mode.mode === "attach") {
    return { url: mode.url };
  }

  const port = process.env.LEARNSPACE_DESKTOP_PORT
    ? Number(process.env.LEARNSPACE_DESKTOP_PORT)
    : await getAvailablePort();
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`LEARNSPACE_DESKTOP_PORT is not a valid port: ${String(port)}`);
  }

  const url = `http://127.0.0.1:${port}`;
  runtimeProcess = mode.mode === "dev" ? spawnDevServer(port) : await spawnPackagedRuntime(port);

  try {
    await waitForServer(`${url}/api/health`, {
      timeoutMs: HEALTH_TIMEOUT_MS,
      intervalMs: HEALTH_POLL_INTERVAL_MS,
    });
  } catch (error) {
    stopRuntime();
    throw error instanceof Error
      ? new Error(`${error.message}${runtimeLogFile !== undefined ? `\nSee ${runtimeLogFile}` : ""}`)
      : error;
  }
  return { url };
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
      applySecurityPolicy();
      createWindow(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stopRuntime();
      dialog.showErrorBox("LearnSpace could not start", message);
      console.error(message);
      app.exit(1);
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    stopRuntime();
  });

  // Desktop session managers (Hyprland, systemd --user) end apps with SIGTERM;
  // without an explicit handler the Chromium SIGTERM path can hang and leave
  // the bundled runtime running.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      app.quit();
    });
  }
}
