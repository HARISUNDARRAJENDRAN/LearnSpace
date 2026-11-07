import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  reactStrictMode: true,
  devIndicators: false,
  experimental: {
    useTypeScriptCli: false,
    webpackMemoryOptimizations: true,
    webpackBuildWorker: true,
    preloadEntriesOnStart: false,
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
  webpack(config) {
    config.resolve.extensions = [
      ".ts",
      ".tsx",
      ...config.resolve.extensions.filter((extension) => extension !== ".ts" && extension !== ".tsx"),
    ];
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
