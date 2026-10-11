import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";

import { completeDesktopAuthHandoff, startDesktopAuthHandoff } from "./auth-handoff.js";
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
let mainWindow: BrowserWindow | undefined;
let applicationOrigin: string | undefined;
let pendingDeepLink: string | undefined;

type DesktopAuthResult = Awaited<ReturnType<typeof completeDesktopAuthHandoff>>;
type PendingDesktopAuth = {
  appOrigin: string;
  verifier: string;
  resolve: (result: DesktopAuthResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  redeeming: boolean;
};

const pendingDesktopAuth = new Map<string, PendingDesktopAuth>();

function takePendingDesktopAuth(flowId: string): PendingDesktopAuth | undefined {
  const pending = pendingDesktopAuth.get(flowId);
  if (pending) {
    pendingDesktopAuth.delete(flowId);
    clearTimeout(pending.timer);
  }
  return pending;
}

function handleGoogleAuthDeepLink(raw: string): boolean {
  let link: URL;
  try {
    link = new URL(raw);
  } catch {
    return false;
  }
  if (link.protocol !== "learnspace:" || link.hostname !== "google-oauth") return false;

  const flowId = link.searchParams.get("flow") ?? "";
  const pending = pendingDesktopAuth.get(flowId);
  if (!pending) return true;
  if (pending.redeeming) return true;
  const code = link.searchParams.get("code");
  if (!code || !/^[A-Za-z0-9_-]{43}$/.test(code)) return true;
  pending.redeeming = true;
  void completeDesktopAuthHandoff(pending.appOrigin, flowId, pending.verifier, code)
    .then((result) => {
      takePendingDesktopAuth(flowId)?.resolve(result);
    }, () => {
      const current = pendingDesktopAuth.get(flowId);
      if (current === pending) current.redeeming = false;
    });
  return true;
}

function openGoogleAuth(
  appOrigin: string,
  flowId: string,
  verifier: string,
  authorizationUrl: string,
): Promise<DesktopAuthResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const pending = takePendingDesktopAuth(flowId);
      pending?.reject(new Error("Google sign-in timed out. Please try again."));
    }, 10 * 60 * 1000);
    timer.unref();
    pendingDesktopAuth.set(flowId, { appOrigin, verifier, resolve, reject, timer, redeeming: false });
    void shell.openExternal(authorizationUrl).catch((reason: unknown) => {
      const pending = takePendingDesktopAuth(flowId);
      pending?.reject(reason instanceof Error ? reason : new Error(String(reason)));
    });
  });
}

function deepLinkFrom(commandLine: string[]): string | undefined {
  return commandLine.find((value) => value.startsWith("learnspace://"));
}

function deepLinkTarget(raw: string, appOrigin: string): string | undefined {
  try {
    const link = new URL(raw);
    const token = link.searchParams.get("token");
    if (link.protocol !== "learnspace:" || !token || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) {
      return undefined;
    }
    if (link.hostname === "verify-email") {
      const target = new URL("/api/auth/verify", appOrigin);
      target.searchParams.set("token", token);
      const next = link.searchParams.get("next");
      if (next && /^\/(?:app|onboarding)(?:[/?]|$)/.test(next)) target.searchParams.set("next", next);
      return target.toString();
    }
    if (link.hostname === "reset-password") {
      const target = new URL("/reset-password", appOrigin);
      target.searchParams.set("token", token);
      return target.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function openDeepLink(raw: string): void {
  if (handleGoogleAuthDeepLink(raw)) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed() || !applicationOrigin) {
    pendingDeepLink = raw;
    return;
  }
  pendingDeepLink = undefined;
  const target = deepLinkTarget(raw, applicationOrigin);
  if (!target) return;
  void mainWindow.loadURL(target);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function spawnDevServer(port: number): ChildProcess {
  const child = spawn(
    "pnpm",
    ["--filter", "@learnspace/web", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: repoRoot,
      stdio: "inherit",
      detached: true,
      env: {
        ...process.env,
        APP_URL: `http://localhost:${port}`,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  );
  child.on("exit", (code, signal) => {
    if (runtimeProcess === child && code !== 0 && signal === null) {
      fail(`LearnSpace dev server exited unexpectedly with code ${code}.`);
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

function fail(message: string): void {
  stopRuntime();
  dialog.showErrorBox("LearnSpace could not start", message);
  app.exit(1);
}

function applySecurityPolicy(appOrigin: string): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url === appOrigin || details.url.startsWith(`${appOrigin}/`)) {
      details.requestHeaders["x-learnspace-desktop"] = "1";
    }
    callback({ requestHeaders: details.requestHeaders });
  });

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

  ipcMain.removeHandler("learnspace:start-google-auth");
  ipcMain.handle("learnspace:start-google-auth", async (event, next: unknown) => {
    const senderUrl = event.senderFrame?.url;
    let senderOrigin: string | undefined;
    try {
      senderOrigin = senderUrl ? new URL(senderUrl).origin : undefined;
    } catch {
      senderOrigin = undefined;
    }
    if (event.sender !== window.webContents || senderOrigin !== appOrigin) {
      throw new Error("Google sign-in can only start from LearnSpace.");
    }
    const destination = typeof next === "string" ? next : "/app";
    if (!/^\/(?:app(?:[/?]|$)|onboarding(?:[/?]|$))/.test(destination)) {
      throw new Error("Invalid sign-in destination.");
    }

    const flowId = randomUUID();
    const verifier = randomBytes(32).toString("base64url");
    await startDesktopAuthHandoff(appOrigin, flowId, verifier);
    const authorizationUrl = new URL("/api/auth/google", appOrigin);
    authorizationUrl.searchParams.set("next", destination);
    authorizationUrl.searchParams.set("desktop_flow", flowId);
    const result = await openGoogleAuth(appOrigin, flowId, verifier, authorizationUrl.toString());
    if (result.status === "error") throw new Error(result.message);
    const target = new URL(result.destination, appOrigin);
    if (target.origin !== appOrigin) throw new Error("Invalid sign-in destination.");
    await event.sender.session.cookies.set({
      url: `${appOrigin}/`,
      name: "learnspace_session",
      value: result.token,
      path: "/",
      httpOnly: true,
      secure: appOrigin.startsWith("https:"),
      sameSite: "lax",
      expirationDate: Math.floor(Date.now() / 1000) + result.maxAge,
    });
    if (!window.isDestroyed()) {
      await window.loadURL(target.toString());
      window.show();
      window.focus();
    }
  });

  window.webContents.setWindowOpenHandler(({ url: target }) => {
    try {
      const parsed = new URL(target);
      if (parsed.origin === appOrigin) return { action: "allow" };
      if (parsed.protocol === "https:") void shell.openExternal(target);
    } catch {
      // Deny malformed targets below.
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
  if (app.isPackaged) {
    const raw: unknown = JSON.parse(
      await readFile(path.join(process.resourcesPath, "release-config.json"), "utf8"),
    );
    const configured = raw && typeof raw === "object"
      ? (raw as Record<string, unknown>).appUrl
      : undefined;
    if (typeof configured !== "string") {
      throw new Error("The packaged LearnSpace service URL is missing.");
    }
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.origin !== configured) {
      throw new Error("The packaged LearnSpace service URL is invalid.");
    }
    return { url: `${configured}/app` };
  }

  const attached = process.env.LEARNSPACE_DESKTOP_SERVER_URL;
  if (attached) {
    const url = new URL(attached);
    if (url.protocol !== "https:" && !(
      url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    )) {
      throw new Error("LEARNSPACE_DESKTOP_SERVER_URL must be HTTPS or a loopback development URL.");
    }
    return { url: `${url.origin}/app` };
  }

  const port = process.env.LEARNSPACE_DESKTOP_PORT
    ? Number(process.env.LEARNSPACE_DESKTOP_PORT)
    : 3000;
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`LEARNSPACE_DESKTOP_PORT is not a valid port: ${String(port)}`);
  }

  const url = `http://localhost:${port}`;
  runtimeProcess = spawnDevServer(port);

  try {
    await waitForServer(`${url}/api/health`, {
      timeoutMs: HEALTH_TIMEOUT_MS,
      intervalMs: HEALTH_POLL_INTERVAL_MS,
    });
  } catch (error) {
    stopRuntime();
    throw error instanceof Error
      ? new Error(error.message)
      : error;
  }
  return { url: `${url}/app` };
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    const deepLink = deepLinkFrom(commandLine);
    if (deepLink) openDeepLink(deepLink);
    const [window] = BrowserWindow.getAllWindows();
    if (window !== undefined) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.focus();
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    openDeepLink(url);
  });

  void app.whenReady().then(async () => {
    try {
      const { url } = await resolveAppUrl();
      applicationOrigin = new URL(url).origin;
      applySecurityPolicy(applicationOrigin);
      const scriptPath = process.argv[1];
      if (process.defaultApp && scriptPath) {
        app.setAsDefaultProtocolClient("learnspace", process.execPath, [path.resolve(scriptPath)]);
      } else if (app.isPackaged) {
        app.setAsDefaultProtocolClient("learnspace");
      }
      const deepLink = deepLinkFrom(process.argv);
      mainWindow = createWindow(
        deepLink ? deepLinkTarget(deepLink, applicationOrigin) ?? url : url,
      );
      if (pendingDeepLink) openDeepLink(pendingDeepLink);
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

  // Desktop session managers (Hyprland, systemd --user) end apps with SIGTERM.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      app.quit();
    });
  }
}
