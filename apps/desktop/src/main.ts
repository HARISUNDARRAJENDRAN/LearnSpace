import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, session, shell } from "electron";
import { appOrigin, appProtocol, externalUrl, googleSignInUrl, handoffUrl, isAppUrl } from "./links.js";

// LearnSpace is a hosted, server-rendered app; the desktop app is a hardened
// window onto it. LEARNSPACE_URL points it at another deployment.
const origin = appOrigin(process.env.LEARNSPACE_URL);
let mainWindow: BrowserWindow | undefined;
let signInNonce: string | undefined;

function openExternal(target: string): void {
  const url = externalUrl(target);
  if (url) void shell.openExternal(url);
}

// Returns whether the target may load inside the app window.
function allowInApp(target: string): boolean {
  const nonce = randomBytes(32).toString("base64url");
  const signIn = googleSignInUrl(target, origin, nonce);
  if (signIn) {
    signInNonce = nonce;
    openExternal(signIn);
    return false;
  }
  if (isAppUrl(target, origin)) return true;
  openExternal(target);
  return false;
}

function load(window: BrowserWindow, url: string): void {
  // Failures surface through did-fail-load.
  window.loadURL(url).catch(() => {});
}

function offlinePage(): string {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>LearnSpace</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;font:16px system-ui,sans-serif;background:#f5f5f0;color:#101416">
<main style="text-align:center"><h1 style="font-size:22px">LearnSpace can't connect</h1>
<p>Check your internet connection, then try again.</p>
<p><a href="${origin}/app" style="color:inherit;font-weight:600">Try again</a></p></main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "LearnSpace",
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (allowInApp(url)) load(window, url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event) => {
    if (!allowInApp(event.url)) event.preventDefault();
  });
  contents.on("will-redirect", (event) => {
    if (event.isMainFrame && !allowInApp(event.url)) event.preventDefault();
  });
  contents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
    // -3 (ERR_ABORTED) means another navigation replaced this one.
    if (isMainFrame && code !== -3) load(window, offlinePage());
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    mainWindow = undefined;
  });
  load(window, `${origin}/app`);
  mainWindow = window;
  return window;
}

function focus(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function receiveLink(link: string | undefined): void {
  const target = link && handoffUrl(link, origin, signInNonce);
  if (!target) return;
  signInNonce = undefined;
  const window = mainWindow ?? createWindow();
  load(window, target);
  focus(window);
}

// AppImages are never installed, so register the entry that routes
// learnspace:// links back to this file. Packaged installers do this themselves.
async function registerAppImage(appImage: string): Promise<void> {
  const dataHome = process.env.XDG_DATA_HOME || path.join(app.getPath("home"), ".local", "share");
  const directory = path.join(dataHome, "applications");
  await mkdir(directory, { recursive: true });
  const exec = appImage.replace(/["`$\\]/g, (character) => `\\${character}`);
  await writeFile(
    path.join(directory, "learnspace.desktop"),
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=LearnSpace",
      `Exec="${exec}" %U`,
      "Terminal=false",
      "Categories=Education;",
      `MimeType=x-scheme-handler/${appProtocol};`,
      "StartupWMClass=learnspace",
      "",
    ].join("\n"),
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows and Linux deliver learnspace:// links as arguments to a second launch.
  app.on("second-instance", (_event, argv) => {
    receiveLink(argv.find((arg) => arg.startsWith(`${appProtocol}://`)));
    if (mainWindow) focus(mainWindow);
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    receiveLink(url);
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (!mainWindow) createWindow();
  });

  void app.whenReady().then(async () => {
    // Remote pages get no camera, microphone, location, or notification access.
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(permission === "fullscreen" || permission === "clipboard-sanitized-write");
    });
    // Development runs (electron .) cannot receive sign-in links; packaged builds can.
    if (app.isPackaged) {
      if (process.env.APPIMAGE) await registerAppImage(process.env.APPIMAGE).catch(() => {});
      app.setAsDefaultProtocolClient(appProtocol);
    }
    createWindow();
  });
}
