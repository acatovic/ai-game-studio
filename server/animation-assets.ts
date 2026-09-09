import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { encodeAseprite } from "../src/lib/aseprite.js";
import { activeSpriteDir, ensureInsideRoot, readPngDims } from "./files.js";

/** Decode the composed PNG so PNG and Aseprite contain exactly the same frames. */
export async function asepriteFromSheet(png: Buffer, count: number, name: string): Promise<Buffer> {
  const dims = readPngDims(png);
  if (!dims || !Number.isInteger(count) || count < 1 || count > 65535 ||
      dims.h < 1 || dims.h > 4096 || dims.w !== dims.h * count || dims.w * dims.h > 32_000_000) {
    throw new Error("Invalid spritesheet dimensions or frame count");
  }
  const expected = dims.w * dims.h * 4;
  const rgba = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-frames:v", "1",
      "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let length = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > expected) { child.kill(); reject(new Error("Decoded spritesheet is too large")); }
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on("error", () => reject(new Error("Could not start ffmpeg to save animation")));
    child.stdin.on("error", () => { /* close/error reports decode failures */ });
    child.on("close", code => {
      if (code !== 0 || length !== expected) reject(new Error("Could not decode spritesheet PNG"));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(png);
  });
  function* frames() {
    const size = dims!.h;
    for (let i = 0; i < count; i++) {
      const pixels = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) {
        const offset = (y * dims!.w + i * size) * 4;
        pixels.set(rgba.subarray(offset, offset + size * 4), y * size * 4);
      }
      yield { width: size, height: size, rgba: pixels };
    }
  }
  return Buffer.from(await (await encodeAseprite(frames(), name)).arrayBuffer());
}

export async function stageAnimationAssets(png: Buffer, count: number, name: string, animationId: string) {
  const aseprite = await asepriteFromSheet(png, count, name);
  // Publish the manifest only once the entire pair exists. Previous assets survive failures.
  const relative = `animations/${animationId}/assets/${randomUUID()}`;
  const dir = path.join(activeSpriteDir(), relative);
  ensureInsideRoot(dir);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(path.join(dir, `${name}.png`), png);
    await writeFile(path.join(dir, `${name}.aseprite`), aseprite);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  return { spritesheet: `${relative}/${name}.png`, aseprite: `${relative}/${name}.aseprite` };
}
