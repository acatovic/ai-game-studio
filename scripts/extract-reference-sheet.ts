import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractReferenceSheet } from "../server/reference-sheet.js";
import { alignReferenceViews } from "../server/character-references.js";
import { REFERENCE_VIEWS } from "../src/lib/character.js";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: npm run extract:references -- <sheet.png> <new-output-directory>");
const sheet = await readFile(path.resolve(input));
const sources = await extractReferenceSheet(sheet);
const aligned = await alignReferenceViews(sources);
// Require a new directory so retries cannot silently mix or overwrite outputs.
const directory = path.resolve(output);
await mkdir(directory);
await writeFile(path.join(directory, "sheet-original.png"), sheet);
for (const view of REFERENCE_VIEWS) {
  await writeFile(path.join(directory, `${view}-original.png`), sources[view]);
  await writeFile(path.join(directory, `${view}.png`), aligned.images[view]);
}
await writeFile(path.join(directory, "alignment.json"), JSON.stringify(aligned.alignment, null, 2) + "\n");
console.log(`Extracted four aligned reference views to ${directory}`);
