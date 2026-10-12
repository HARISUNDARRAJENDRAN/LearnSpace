import { readdir } from "node:fs/promises";

const envFiles = (await readdir(process.cwd())).filter((name) => /^\.env(?:\..+)?$/.test(name) && name !== ".env.example");

if (envFiles.length > 0) {
  console.error(`Refusing production build with project environment files present: ${envFiles.join(", ")}`);
  process.exit(1);
}
