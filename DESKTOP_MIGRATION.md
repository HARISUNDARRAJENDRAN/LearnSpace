# Desktop Migration (Linux / Electron)

## Current state

Complete: the LearnSpace web app ships as a Linux desktop application
(`apps/desktop`) built on Electron 44.7.0. The Electron shell is thin — it
spawns the bundled Next.js standalone runtime on `127.0.0.1:<free-port>` and
loads it in a hardened BrowserWindow. No second frontend, no Tauri/Vite
rewrite; `apps/web` remains the single source of the product UI.

Artifacts (electron-builder, Linux-only target):

- `apps/desktop/dist-release/LearnSpace-0.1.0.AppImage`
- `apps/desktop/dist-release/learnspace_0.1.0_amd64.deb`

Commands:

- `pnpm desktop:dev` — spawn Next dev server, open secure window on it.
- `pnpm desktop:build` — build web app + stage standalone runtime into
  `apps/desktop/dist-runtime/runtime`.
- `pnpm desktop:package` — full package pipeline (web build, runtime stage,
  electron-builder AppImage + deb with fuse hardening via afterPack hook).
- `pnpm desktop:smoke` — Playwright boot smoke (dev electron binary).
  `LEARNSPACE_SMOKE_PACKAGED=1` launches the packaged `linux-unpacked`
  binary instead (asar entry + fuses + bundled runtime).
- `node apps/desktop/scripts/packaged-e2e.mjs` — packaged feature-parity
  E2E over Chromium CDP: register → desktop-exposed verification link →
  authenticated onboarding → cookie-cleared password login → SIGTERM
  teardown closes the runtime port.

Environment overrides:

- `LEARNSPACE_DESKTOP_SERVER_URL` — attach to an already-running loopback
  server instead of spawning one.
- `LEARNSPACE_DESKTOP_PORT` — pin the managed runtime port.
- `LEARNSPACE_DESKTOP_RUNTIME_DIR` — override the bundled runtime path
  (used by dev/test harnesses).

## Architecture

- Electron main (`apps/desktop/src/main.ts`) classifies launch mode
  (attach / dev / packaged), spawns the runtime as a process group, waits
  for `/api/health`, then opens a BrowserWindow on `http://127.0.0.1:<port>`.
- Packaged mode runs the Next standalone `server.js` through
  `process.execPath` with `ELECTRON_RUN_AS_NODE=1` (bundled runtime; no
  system Node required).
- Runtime environment (`apps/desktop/src/config.ts`) builds a minimal,
  loopback-only env for the child: strips inherited `NODE_OPTIONS`/`APP_URL`
  etc., generates a per-user `AUTH_SECRET` in userData (mode 0600), and
  defaults service endpoints to local Compose loopback ports
  (Postgres 55432, Redis 56379, AI 8080), overridable via
  `userData/config.json`.
- Desktop auth mode (`apps/web/lib/auth/{config,cookies,email}.ts`): when
  `LEARNSPACE_DESKTOP_RUNTIME=true` is set by the Electron parent (never
  inferred from request headers), the web app accepts the http loopback
  origin for cookies/redirects and exposes verification/reset links in the
  UI instead of requiring email delivery. Hosted https rules are unchanged.

## Security hardening

- BrowserWindow: `nodeIntegration: false`, `contextIsolation: true`,
  `sandbox: true`, `webSecurity: true`, `webviewTag: false`,
  `allowRunningInsecureContent: false`.
- Permission handlers deny all permission requests/checks.
- Desktop CSP injected on loopback responses via `onHeadersReceived`.
- Navigation locked to the app origin; external https links open via
  `shell.openExternal`; window-open handler allowlists same-origin.
- Electron fuses (afterPack): cookie encryption ON, asar integrity ON,
  only-load-app-from-asar ON, NodeOptions/NodeCliInspect disabled,
  LoadBrowserProcessSpecificV8Snapshot OFF (required for
  `ELECTRON_RUN_AS_NODE` runtime child), RunAsNode ON (required for the
  bundled runtime spawn).
- SIGTERM/SIGINT → graceful quit; runtime process group is SIGTERM'd then
  SIGKILL'd after 5s; verified no orphan processes or held ports.

## Verification performed

- Desktop unit tests: 19/19 green (`apps/desktop/tests/`).
- Web auth tests: 11/11 green with desktop-mode cases; onboarding
  integration tests pass against the Compose database.
- Packaged QA (Electron 44.7.0 build): runtime health 200 in ~5s, landing
  page renders on Wayland, SIGTERM tears down cleanly (runtime port closed,
  zero orphan processes).
- Packaged E2E (CDP): register → verification link → onboarding session →
  password login in cookie-cleared context → clean exit. Screenshots in
  `/tmp/learnspace-desktop-e2e/`.
- Fuses behaviorally verified on the packaged binary: `ELECTRON_RUN_AS_NODE`
  works; `NODE_OPTIONS=--require` injection is ignored.
- Artifact scan: no `.env`/key/credential files inside asar, deb data
  tarball, or bundled runtime; only the documented local Compose
  connection-string defaults appear in compiled config (matching
  `docker-compose.yml`).

## Dependency audit

- `pnpm audit` desktop-scoped advisories: 1 remaining (`sprintf-js` via
  electron-builder's build-time dependency chain; no upstream patch
  available; not shipped in runtime artifacts). Electron advisories fixed
  by the 40 → 44.7.0 upgrade.
- Web-app transitive advisories (tailwind/postcss chain) predate this
  migration and are out of scope for the desktop shell.

## Known limitations

- Backends (PostgreSQL, Redis, FastAPI, workers) remain external. The
  desktop app connects to loopback service ports (Compose defaults);
  provisioning those services is outside the app bundle.
- Deb builds on Arch hosts need `libxcrypt-compat` (fpm's bundled Ruby
  requires `libcrypt.so.1`); AppImage builds need
  `APPIMAGE_EXTRACT_AND_RUN=1` when FUSE is unavailable (e.g. containers).
  On Debian/Ubuntu packaging hosts neither workaround is required.
- Playwright's `_electron` driver cannot attach to the packaged binary
  (Node inspector is fuse-disabled by design); packaged E2E uses Chromium
  remote debugging (`--remote-debugging-port`) instead.
- Wayland: Chromium prints a harmless Vulkan compatibility warning; no
  forced X11 flags.
- X11: not separately exercised on this machine (Wayland session);
  Electron's X11 backend is standard and no platform-specific code paths
  were introduced by this work.
