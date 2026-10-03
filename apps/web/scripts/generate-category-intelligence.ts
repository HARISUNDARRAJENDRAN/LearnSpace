import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getCurriculum } from "../lib/discovery/curriculum";
import { getCategoryIntelligence } from "../lib/discovery/category-intelligence";

const path = resolve(process.cwd(), "lib/discovery/generated/category-intelligence.json");
const categories = (await getCurriculum()).flatMap((area) => area.categories).filter((category) => category.items.some((item) => item.url));
const output = `${JSON.stringify(Object.fromEntries(categories.map((category) => [category.slug, getCategoryIntelligence(category)])), null, 2)}\n`;
if (await readFile(path, "utf8") !== output) await writeFile(path, output);
console.log(`Category intelligence is current for ${categories.length} collections.`);
