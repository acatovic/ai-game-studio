import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pngFixture } from "./helpers/png.ts";

test("latest follows committed revisions, preserves both outputs on failures, and clears stale copies", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-latest-"));
  process.env.AI_GAME_STUDIO_HOME = root;
  const { withAnimationLatest } = await import("../server/animation-latest.js");
  const { stageAnimationAssets } = await import("../server/animation-assets.js");
  const { projectContext } = await import("../server/files.js");
  const sprite = path.join(root, "game/sprites/hero");
  const latest = path.join(sprite, "animations/idle/assets/latest");
  const png = pngFixture(1, 1, [20, 30, 40, 128]);
  try {
    await mkdir(sprite, { recursive: true });
    await withAnimationLatest(sprite, "idle", { spritesheet: null, aseprite: null });
    assert.deepEqual(await readdir(latest), []);
    const first = await projectContext.run({ name: "game", spriteId: "hero", animationId: "idle" },
      () => stageAnimationAssets(png, 1, "idle", "idle"));
    await withAnimationLatest(sprite, "idle", first);
    const aseprite = await readFile(path.join(sprite, first.aseprite));
    assert.deepEqual(await readFile(path.join(latest, "idle.png")), png);
    assert.deepEqual(await readFile(path.join(latest, "idle.aseprite")), aseprite);
    const second = { spritesheet: "animations/idle/assets/next/idle.png", aseprite: "animations/idle/assets/next/idle.aseprite" };
    await mkdir(path.dirname(path.join(sprite, second.spritesheet)), { recursive: true });
    await writeFile(path.join(sprite, second.spritesheet), "new png");
    await assert.rejects(withAnimationLatest(sprite, "idle", second), { code: "ENOENT" });
    assert.deepEqual(await readFile(path.join(latest, "idle.png")), png);
    assert.deepEqual(await readFile(path.join(latest, "idle.aseprite")), aseprite);
    await writeFile(path.join(sprite, second.aseprite), "new aseprite");
    await assert.rejects(withAnimationLatest(sprite, "idle", second, async () => {
      throw new Error("manifest commit failed");
    }), /manifest commit failed/);
    assert.deepEqual(await readFile(path.join(latest, "idle.png")), png);
    assert.deepEqual(await readFile(path.join(latest, "idle.aseprite")), aseprite);
    await withAnimationLatest(sprite, "idle", second);
    assert.equal(await readFile(path.join(latest, "idle.png"), "utf8"), "new png");
    assert.equal(await readFile(path.join(latest, "idle.aseprite"), "utf8"), "new aseprite");
    // Convenience copies are independent of the retained originals.
    await writeFile(path.join(latest, "idle.png"), "edited convenience copy");
    assert.equal(await readFile(path.join(sprite, second.spritesheet), "utf8"), "new png");
    await withAnimationLatest(sprite, "idle", second);
    assert.equal(await readFile(path.join(latest, "idle.png"), "utf8"), "new png");
    await withAnimationLatest(sprite, "idle", { spritesheet: null, aseprite: null });
    assert.deepEqual(await readdir(latest), []);
    assert.deepEqual(await readFile(path.join(sprite, first.spritesheet)), png);
    assert.equal(await readFile(path.join(sprite, second.aseprite), "utf8"), "new aseprite");
    await assert.rejects(withAnimationLatest(sprite, "../escape", first), /Invalid/);
    await assert.rejects(withAnimationLatest(sprite, "idle", { ...first, spritesheet: "../../outside.png" }), /outside character/);
    assert.deepEqual((await readdir(path.dirname(latest))).filter(name => name.startsWith('.')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
