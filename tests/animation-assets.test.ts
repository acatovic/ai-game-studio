import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { asepriteFromSheet } from "../server/animation-assets.ts";
import { pngFixture } from "./helpers/png.ts";

test("saved Aseprite splits the PNG into ordered, lossless RGBA frames", async () => {
  // Two 2×2 cells laid out horizontally, including soft and zero alpha.
  const rgba = [255,0,0,255, 0,255,0,128, 0,0,255,255, 2,3,4,0,
    5,6,7,64, 8,9,10,255, 11,12,13,32, 14,15,16,255];
  const png = pngFixture(4, 2, rgba);
  const ase = await asepriteFromSheet(png, 2, "scientist-walking");
  assert.equal(ase.readUInt16LE(6), 2);
  assert.equal(ase.readUInt16LE(8), 2);
  assert.equal(ase.readUInt16LE(10), 2);
  let offset = 128;
  const pixels: Buffer[] = [];
  for (let f = 0; f < 2; f++) {
    const end = offset + ase.readUInt32LE(offset);
    assert.equal(ase.readUInt16LE(offset + 8), 83);
    offset += 16;
    while (offset < end) {
      const size = ase.readUInt32LE(offset);
      if (ase.readUInt16LE(offset + 4) === 0x2005) pixels.push(inflateSync(ase.subarray(offset + 26, offset + size)));
      offset += size;
    }
  }
  assert.deepEqual(pixels[0], Buffer.from([...rgba.slice(0,8), ...rgba.slice(16,24)]));
  assert.deepEqual(pixels[1], Buffer.from([...rgba.slice(8,16), ...rgba.slice(24,32)]));
  await assert.rejects(asepriteFromSheet(png, 0, "idle"), /Invalid/);
  await assert.rejects(asepriteFromSheet(png, 3, "idle"), /Invalid/);
  await assert.rejects(asepriteFromSheet(png.subarray(0, 30), 2, "idle"), /decode/);
});
