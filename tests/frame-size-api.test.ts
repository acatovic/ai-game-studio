import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { FRAME_SIZES } from "../src/lib/frame-size.ts";
import { hydrateFromView } from "../src/lib/state.ts";
import type { ProjectView } from "../src/lib/api.ts";
import { pngFixture } from "./helpers/png.ts";

function sheetFixture(size: number) {
  const rgba = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size * 2; x++) {
    rgba.push(...(y < size / 4 ? [0, 0, 0, 0] : x < size ? [255, 0, 0, 255] : [0, 0, 255, 255]));
  }
  return { png: pngFixture(size * 2, size, rgba), rgba: Buffer.from(rgba) };
}

test("frame sizes persist per animation and rebuild matching outputs without changing source frames", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-frame-size-"));
  const child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    env: { ...process.env, PORT: "0", AI_GAME_STUDIO_HOME: root, OPENROUTER_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Server startup timed out")), 10000);
      child.stdout.on("data", chunk => {
        const port = String(chunk).match(/http:\/\/localhost:(\d+)/)?.[1];
        if (port) { clearTimeout(timer); resolve(`http://localhost:${port}`); }
      });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(stderr)); });
    });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const post = (route: string, body: unknown) => fetch(base + route, { method: "POST", headers, body: JSON.stringify(body) });
    const ok = async (route: string, body: unknown): Promise<ProjectView> => {
      const response = await post(route, body);
      const json = await response.json();
      assert.equal(response.status, 200, JSON.stringify(json));
      return json;
    };
    const current = async (): Promise<ProjectView> => (await fetch(base + "/api/projects/current", { headers })).json();
    const bytes = async (url: string) => Buffer.from(await (await fetch(base + url)).arrayBuffer());
    const draft = { spritePrompt: "hero", motionPrompt: "walk", spriteModel: "openai/gpt-image-2",
      motionModel: "x-ai/grok-imagine-video" };
    await ok("/api/projects/new", { name: "sizes" });
    headers["X-Project-Name"] = "sizes";
    await ok("/api/projects/sprites/new", { value: "hero" });
    headers["X-Sprite-Id"] = "hero";
    assert.equal((await post("/api/projects/draft", { ...draft, frameSize: 64 })).status, 400);
    const initial = await ok("/api/projects/animations/new", { value: "walk" });
    assert.equal(initial.frameSize, 128);
    assert.equal(initial.spritesheetFrameSize, null);
    headers["X-Animation-Id"] = "walk";
    const dir = path.join(root, "sizes/sprites/hero/animations/walk");
    const file = path.join(dir, "animation.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    const source = sheetFixture(128).png;
    await mkdir(path.join(dir, "frames"));
    await writeFile(path.join(dir, "frames/source.png"), source);
    await writeFile(file, JSON.stringify({ ...manifest, frames: ["animations/walk/frames/source.png", "animations/walk/frames/source.png"],
      selectedFrameIndices: [0, 1] }));
    let saved: ProjectView = initial;
    for (const size of FRAME_SIZES) {
      const previous = saved;
      const pending = await ok("/api/projects/draft", { ...draft, frameSize: size });
      assert.equal(pending.frameSize, size);
      assert.equal(pending.spritesheetFrameSize, previous.spritesheetFrameSize);
      assert.equal(pending.spritesheetUrl, previous.spritesheetUrl);
      const { png, rgba } = sheetFixture(size);
      saved = await ok("/api/projects/spritesheet", { dataUrl: `data:image/png;base64,${png.toString("base64")}`, frameSize: size });
      assert.equal(saved.frameSize, size);
      assert.equal(saved.spritesheetFrameSize, size);
      assert.equal(saved.spritesheetFrameCount, 2);
      assert.deepEqual(await bytes(saved.spritesheetUrl!), png);
      const ase = await bytes(saved.asepriteUrl!);
      assert.equal(ase.readUInt16LE(6), 2);
      assert.equal(ase.readUInt16LE(8), size);
      assert.equal(ase.readUInt16LE(10), size);
      let offset = 128;
      for (let frame = 0; frame < 2; frame++) {
        const end = offset + ase.readUInt32LE(offset);
        offset += 16;
        let decoded: Buffer | undefined;
        while (offset < end) {
          const length = ase.readUInt32LE(offset);
          if (ase.readUInt16LE(offset + 4) === 0x2005) decoded = inflateSync(ase.subarray(offset + 26, offset + length));
          offset += length;
        }
        const expected = Buffer.concat(Array.from({ length: size }, (_, y) => {
          const start = (y * size * 2 + frame * size) * 4;
          return rgba.subarray(start, start + size * 4);
        }));
        assert.deepEqual(decoded, expected, `${size}px Aseprite frame ${frame} must match the PNG`);
      }
      assert.ok(saved.previewGifUrl, stderr);
      const gif = await bytes(saved.previewGifUrl);
      const decoded = spawnSync("ffmpeg", ["-v", "error", "-ignore_loop", "1", "-i", "pipe:0",
        "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
        { input: gif, maxBuffer: 1_000_000 });
      assert.equal(decoded.status, 0, decoded.stderr.toString());
      assert.equal(decoded.stdout.length, 200 * 200 * 4 * 2);
      assert.equal(decoded.stdout[3], 0, "the GIF preserves transparent padding");
      assert.deepEqual([...decoded.stdout.subarray((100 * 200 + 100) * 4, (100 * 200 + 100) * 4 + 4)], [255, 0, 0, 255]);
      const secondCenter = (200 * 200 + 100 * 200 + 100) * 4;
      assert.deepEqual([...decoded.stdout.subarray(secondCenter, secondCenter + 4)], [0, 0, 255, 255]);
      assert.deepEqual(await readFile(path.join(dir, "frames/source.png")), source);
      if (previous.spritesheetUrl) {
        assert.equal((await fetch(base + previous.spritesheetUrl)).status, 200, "previous revisions remain available");
        assert.equal((await fetch(base + previous.previewGifUrl)).status, 200);
      }
    }

    // Size validation happens before any draft or output is committed.
    const before = await readFile(file, "utf8");
    const validPng = sheetFixture(256).png;
    for (const frameSize of [0, -1, 65, 128.5, 512, "64", null]) {
      assert.equal((await post("/api/projects/draft", { ...draft, frameSize })).status, 400);
      assert.equal((await post("/api/projects/spritesheet", {
        frameSize, dataUrl: `data:image/png;base64,${validPng.toString("base64")}`,
      })).status, 400);
    }
    for (const png of [sheetFixture(64).png, validPng.subarray(0, 40)]) {
      assert.equal((await post("/api/projects/spritesheet", {
        frameSize: 256, dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      })).status, 400);
    }
    assert.equal(await readFile(file, "utf8"), before);

    // Other tabs cannot redirect a size write to their currently selected animation.
    const other = await ok("/api/projects/animations/new", { value: "idle" });
    assert.equal(other.frameSize, 128);
    const pending = await ok("/api/projects/draft", { ...draft, frameSize: 64 });
    assert.equal(pending.activeAnimationId, "walk");
    assert.equal(pending.spritesheetFrameSize, 256);
    assert.equal(hydrateFromView(pending).frameSize, 64);
    assert.equal(hydrateFromView(pending).spritesheetFrameSize, 256);
    headers["X-Animation-Id"] = "idle";
    assert.equal((await current()).frameSize, 128);
    delete headers["X-Animation-Id"];
    assert.equal((await post("/api/projects/draft", { ...draft, frameSize: 256 })).status, 400);
    assert.equal((await post("/api/projects/spritesheet", {
      frameSize: 256, dataUrl: `data:image/png;base64,${validPng.toString("base64")}`,
    })).status, 400);
    headers["X-Animation-Id"] = "walk";
    await ok("/api/projects/animations/rename", { value: "run" });
    headers["X-Animation-Id"] = "run";
    const duplicate = await ok("/api/projects/animations/duplicate", { value: "run-copy" });
    assert.equal(duplicate.frameSize, 64);
    assert.equal(duplicate.spritesheetFrameSize, 256);
    headers["X-Animation-Id"] = "run-copy";
    const reopened = await ok("/api/projects/load", { name: "sizes" });
    assert.equal(reopened.frameSize, 64);
    assert.equal(reopened.spritesheetFrameSize, 256);
    assert.equal((await bytes(reopened.asepriteUrl!)).readUInt16LE(8), 256);

    // Old manifests acquire defaults in the view without rewriting their files on read.
    headers["X-Animation-Id"] = "idle";
    const legacyFile = path.join(root, "sizes/sprites/hero/animations/idle/animation.json");
    const legacy = JSON.parse(await readFile(legacyFile, "utf8"));
    delete legacy.frameSize;
    delete legacy.spritesheetFrameSize;
    const legacyJson = JSON.stringify(legacy);
    await writeFile(legacyFile, legacyJson);
    assert.equal((await current()).frameSize, 128);
    assert.equal(await readFile(legacyFile, "utf8"), legacyJson);
    headers["X-Animation-Id"] = "missing";
    assert.equal((await post("/api/projects/draft", { ...draft, frameSize: 64 })).status, 400);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
