import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PROJECTS_DIR } from "../server/storage.js";
import { withAnimationLatest } from "../server/animation-latest.js";

async function directories(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

let animations = 0;
let outputs = 0;
for (const project of await directories(PROJECTS_DIR)) {
  const sprites = path.join(PROJECTS_DIR, project, "sprites");
  for (const sprite of await directories(sprites)) {
    const spriteDir = path.join(sprites, sprite);
    for (const animation of await directories(path.join(spriteDir, "animations"))) {
      const file = path.join(spriteDir, "animations", animation, "animation.json");
      let manifest: { spritesheet: string | null; aseprite: string | null };
      try { manifest = JSON.parse(await readFile(file, "utf8")); }
      catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") continue; throw err; }
      await withAnimationLatest(spriteDir, animation, manifest);
      animations++;
      outputs += Number(!!manifest.spritesheet) + Number(!!manifest.aseprite);
    }
  }
}
console.log(`Updated assets/latest for ${animations} animations (${outputs} files) in ${PROJECTS_DIR}.`);
