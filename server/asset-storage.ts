import { rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ensureInsideRoot } from "./files.js";

export async function deleteAssetFolder(source: string, commit: () => Promise<void>): Promise<void> {
  ensureInsideRoot(source);
  const staged = path.join(path.dirname(source), `.deleted-${randomUUID()}`);
  ensureInsideRoot(staged);
  await rename(source, staged);
  try {
    await commit();
  } catch (error) {
    await rename(staged, source);
    throw error;
  }
  // The manifest no longer references this folder. Cleanup cannot undo that commit.
  await rm(staged, { recursive: true, force: true }).catch(() => {
    console.warn("Deleted asset removed from project, but its staged folder could not be cleaned up.");
  });
}
