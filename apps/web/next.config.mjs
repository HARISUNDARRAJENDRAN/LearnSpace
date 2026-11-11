import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  reactStrictMode: true,
  devIndicators: false,
  experimental: {
    useTypeScriptCli: false,
    preloadEntriesOnStart: false,
    // The dev cache restored stale copies of edited files after restarts (next dev restarts itself near its memory cap),
    // so every page load compiled a "new" version and reloaded each open tab with an HMR hash mismatch, in a loop.
    turbopackFileSystemCacheForDev: false,
  },
  onDemandEntries: {
    maxInactiveAge: 30_000,
    pagesBufferLength: 2,
  },
  output: "standalone",
  outputFileTracingRoot: path.join(appDirectory, "../.."),
  transpilePackages: ["@learnspace/db", "@learnspace/shared"],
  // YouTube already serves sized thumbnails; resizing them again would spend image-optimization quota for no gain.
  images: { unoptimized: true },
  // Cross-origin isolates the app's pages, so Luna's on-device voice models run on every CPU core instead of one (about
  // twice as fast). Unlike COOP/COEP it asks nothing of embedded frames, so the YouTube player is unaffected; browsers
  // without it run the models on one thread.
  headers: () => [{ source: "/app/:path*", headers: [{ key: "Document-Isolation-Policy", value: "isolate-and-credentialless" }] }],
};

export default nextConfig;
