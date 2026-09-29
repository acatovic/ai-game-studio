import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ensureInsideRoot, safeAssetId } from "./files.js";

interface AnimationOutputs { spritesheet: string | null; aseprite: string | null }

/** Publish convenient copies of the manifest's outputs, restoring the previous pair on failure. */
export async function withAnimationLatest(
  spriteDir: string, animationId: string, outputs: AnimationOutputs,
  commit: () => Promise<void> = async () => {},
): Promise<void> {
  ensureInsideRoot(spriteDir);
  safeAssetId(animationId);
  const assets = path.join(spriteDir, "animations", animationId, "assets");
  ensureInsideRoot(assets);
  const latest = path.join(assets, "latest");
  const staged = path.join(assets, `.latest-${randomUUID()}`);
  const previous = path.join(assets, `.previous-latest-${randomUUID()}`);
  await mkdir(staged, { recursive: true });
  let backedUp = false;
  let published = false;
  try {
    for (const key of ["spritesheet", "aseprite"] as const) {
      const relative = outputs[key];
      if (!relative) continue;
      const source = path.resolve(spriteDir, relative);
      ensureInsideRoot(source);
      if (!source.startsWith(path.resolve(spriteDir) + path.sep)) throw new Error("Path outside character directory");
      await copyFile(source, path.join(staged, `${animationId}${key === "spritesheet" ? ".png" : ".aseprite"}`));
    }
    try { await rename(latest, previous); backedUp = true; }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
    await rename(staged, latest);
    published = true;
    await commit();
  } catch (err) {
    if (published) await rm(latest, { recursive: true, force: true });
    if (backedUp) await rename(previous, latest);
    throw err;
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
  // Cleanup must not turn a successful manifest commit into a failed save.
  if (backedUp) await rm(previous, { recursive: true, force: true }).catch(() => {
    console.warn("Animation saved, but the previous latest copies could not be cleaned up.");
  });
}
