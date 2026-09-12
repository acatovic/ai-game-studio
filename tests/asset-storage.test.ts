import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("asset deletion restores files if metadata commit fails and removes them after success", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-delete-"));
  process.env.AI_GAME_STUDIO_HOME = root;
  const { deleteAssetFolder } = await import("../server/asset-storage.ts");
  const source = path.join(root, "idle");
  try {
    await mkdir(source);
    await writeFile(path.join(source, "output.png"), "original output");
    let committed = false;
    await assert.rejects(deleteAssetFolder(source, async () => {
      await assert.rejects(readFile(path.join(source, "output.png")), { code: "ENOENT" });
      throw new Error("metadata write failed");
    }), /metadata write failed/);
    assert.equal(await readFile(path.join(source, "output.png"), "utf8"), "original output");
    assert.deepEqual(await readdir(root), ["idle"]);
    await deleteAssetFolder(source, async () => { committed = true; });
    assert.equal(committed, true);
    assert.deepEqual(await readdir(root), []);
    committed = false;
    await assert.rejects(deleteAssetFolder(source, async () => { committed = true; }), { code: "ENOENT" });
    assert.equal(committed, false);
    await assert.rejects(deleteAssetFolder(path.join(root, "..", "outside"), async () => {}), /outside project storage/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
