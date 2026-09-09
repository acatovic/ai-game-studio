import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { encodeAseprite } from "../src/lib/aseprite.ts";

test("Aseprite export has valid frame/chunk boundaries and lossless RGBA cels", async () => {
  const pixels = [
    new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0]),
    new Uint8Array([0, 255, 0, 128, 12, 34, 56, 255]),
  ];
  const blob = await encodeAseprite(pixels.map(rgba => ({ width: 2, height: 1, rgba })), "Héro");
  const data = Buffer.from(await blob.arrayBuffer());
  assert.equal(data.readUInt32LE(0), data.length);
  assert.equal(data.readUInt16LE(4), 0xa5e0);
  assert.equal(data.readUInt16LE(6), 2);
  assert.equal(data.readUInt16LE(8), 2);
  assert.equal(data.readUInt16LE(10), 1);
  assert.equal(data.readUInt16LE(12), 32);
  assert.equal(data.readUInt32LE(14), 1);
  assert.equal(data.readUInt16LE(18), 83);
  assert.deepEqual([...data.subarray(34, 36)], [1, 1]);
  assert.ok(data.subarray(44, 128).every(b => b === 0));
  let offset = 128;
  for (let frame = 0; frame < 2; frame++) {
    const end = offset + data.readUInt32LE(offset);
    assert.equal(data.readUInt16LE(offset + 4), 0xf1fa);
    assert.equal(data.readUInt16LE(offset + 8), 83);
    const chunks = data.readUInt32LE(offset + 12);
    assert.equal(chunks, frame === 0 ? 2 : 1);
    assert.equal(data.readUInt16LE(offset + 6), chunks);
    offset += 16;
    for (let i = 0; i < chunks; i++) {
      const size = data.readUInt32LE(offset);
      const type = data.readUInt16LE(offset + 4);
      const chunk = data.subarray(offset, offset + size);
      if (type === 0x2004) {
        assert.equal(frame, 0);
        assert.equal(chunk.readUInt16LE(6), 3);
        assert.equal(chunk.readUInt16LE(8), 0);
        assert.equal(chunk[18], 255);
        assert.equal(chunk.subarray(24).toString("utf8"), "Héro");
        assert.equal(chunk.readUInt16LE(22), Buffer.byteLength("Héro"));
      } else {
        assert.equal(type, 0x2005);
        assert.equal(chunk.readUInt16LE(6), 0);
        assert.equal(chunk.readInt16LE(8), 0);
        assert.equal(chunk.readInt16LE(10), 0);
        assert.equal(chunk[12], 255);
        assert.equal(chunk.readUInt16LE(13), 2);
        assert.equal(chunk.readUInt16LE(22), 2);
        assert.equal(chunk.readUInt16LE(24), 1);
        assert.deepEqual(inflateSync(chunk.subarray(26)), Buffer.from(pixels[frame]));
      }
      offset += size;
    }
    assert.equal(offset, end);
  }
  assert.equal(offset, data.length);
});

test("Aseprite export rejects invalid dimensions, pixels, timing, and empty animations", async () => {
  const frame = { width: 1, height: 1, rgba: new Uint8Array(4) };
  await assert.rejects(encodeAseprite([]), /Frame count/);
  await assert.rejects(encodeAseprite([frame], "Sprite", 0), /duration/);
  await assert.rejects(encodeAseprite([{ ...frame, width: 65536 }]), /width/);
  await assert.rejects(encodeAseprite([{ ...frame, rgba: new Uint8Array(3) }]), /RGBA/);
  await assert.rejects(encodeAseprite([frame, { ...frame, width: 2 }]), /matching dimensions/);
});
