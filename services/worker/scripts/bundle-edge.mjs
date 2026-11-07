// Bundles the serverless worker into one ESM file for the Supabase Edge Function (Deno).
import { builtinModules } from "node:module";
import { build } from "esbuild";

await build({
  entryPoints: [new URL("../src/edge.ts", import.meta.url).pathname],
  outfile: new URL("../../../supabase/functions/discovery-worker/worker.js", import.meta.url).pathname,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  // Deno has no `process`, `Buffer`, `setImmediate` or `require` globals in function code; CommonJS deps (ioredis) need `require`.
  banner: { js: 'import process from "node:process"; import { Buffer } from "node:buffer"; import { setImmediate, clearImmediate } from "node:timers"; import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  plugins: [{
    name: "node-builtins",
    // Deno resolves Node built-ins only through the `node:` scheme.
    setup(builder) {
      builder.onResolve({ filter: new RegExp(`^(${builtinModules.filter((name) => !name.startsWith("_")).join("|")})$`) }, ({ path }) => ({ path: `node:${path}`, external: true }));
    },
  }],
});
