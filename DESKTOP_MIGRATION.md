# Desktop Migration (Linux / Electron)

## Current state

Stage 2 complete: a thin Electron shell (`apps/desktop`) boots the existing
LearnSpace `apps/web` application on Linux. No changes were made to the web
application, backend, or services.

- `pnpm desktop:dev` — spawns the Next.js dev server on a free 127.0.0.1 port,
  waits for `/api/health`, then opens a secure BrowserWindow on it.
- `pnpm desktop:smoke` — Playwright-driven boot verification with screenshot
  (`/tmp/learnspace-desktop-smoke.png` by default).
- `LEARNSPACE_DESKTOP_SERVER_URL` (loopback http/https) — attach to an
  already-running server instead of spawning one.
- `LEARNSPACE_DESKTOP_PORT` — pin the managed dev-server port.

## Completed steps

- Stage 1 audit: Next.js 16.3.8, `output: "standalone"` already enabled
  (`apps/web/next.config.mjs:20`), production runs `apps/web/server.js` from
  the standalone build (see `Dockerfile` and `apps/web/scripts/start-standalone.mjs`).
- Stage 2: Electron 40 shell with `nodeIntegration: false`,
  `contextIsolation: true`, `sandbox: true`, `webSecurity: true`; minimal
  sandboxed preload (`apps/desktop/src/preload.cjs`) exposes only
  `learnspaceDesktop.platform`. Managed runtime is killed as a process group on
  quit; single-instance lock; external http(s) links open via `shell.openExternal`.
- Unit tests: `waitForServer` health probe + free-port helper (5/5 green).
- Manual QA: managed-mode boot and attach-mode boot both render the existing
  LearnSpace landing page inside Electron on Wayland; no orphan processes or
  held ports after exit; invalid attach URL exits 1 with a clear error.

## Key architectural decisions

- Electron is a thin shell that reuses `apps/web` as the renderer content by
  loading the local Next.js server over http://127.0.0.1. No second frontend.
- Chosen runtime path for packaging (Stage 3): ship the Next standalone build
  (already configured) and have the main process launch it locally; dev mode
  spawns `next dev` today.
- Backends (PostgreSQL, Redis, FastAPI, workers) remain external; the desktop
  app is only the client/runtime shell.

## Known issues / open design points

- Auth requires `APP_URL` with https in production mode
  (`apps/web/lib/auth/config.ts:31`). For a packaged local runtime on
  http://127.0.0.1, decide in Stage 3: run the packaged runtime with
  `AUTH_TEST_MODE=true`-style relaxed config, or give the desktop runtime a
  fixed https origin (e.g. custom scheme/reverse proxy). Cookies must keep
  working in the BrowserWindow.
- Host-side managed dev server does not inject DATABASE_URL/REDIS_URL; pages
  that query the database need a host `.env` (the Compose stack provides them
  in-container). Attach mode against `docker compose up` web works today.
- No electron-builder config yet (Stage 7); Linux-only target planned
  (AppImage + .deb).
- Wayland: Electron 40 runs under the current Wayland session; a Vulkan
  warning is printed by Chromium but harmless. No forced X11 flags.

## Next step (Stage 3)

Make the packaged standalone runtime launch from Electron without a dev
server: bundle `apps/web/.next/standalone` + static + public into the desktop
app resources, spawn it via `start:standalone`-equivalent on 127.0.0.1 with a
free port and production env, resolve the auth `APP_URL`/cookie decision
above, and re-run the smoke gate.
