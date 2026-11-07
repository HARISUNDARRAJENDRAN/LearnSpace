import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadCurriculumFromCsv } from "../lib/discovery/curriculum-source";
import { getCategoryIntelligence } from "../lib/discovery/category-intelligence";

async function writeIfChanged(file: string, value: unknown): Promise<void> {
  const path = resolve(process.cwd(), "lib/discovery/generated", file);
  const output = `${JSON.stringify(value, null, 2)}\n`;
  if (await readFile(path, "utf8").catch(() => null) !== output) await writeFile(path, output);
}

const curriculum = await loadCurriculumFromCsv();
await writeIfChanged("curriculum.json", curriculum);
const categories = curriculum.flatMap((area) => area.categories).filter((category) => category.items.some((item) => item.url));
await writeIfChanged("category-intelligence.json", Object.fromEntries(categories.map((category) => [category.slug, getCategoryIntelligence(category)])));
console.log(`Curriculum and category intelligence are current for ${categories.length} collections.`);
