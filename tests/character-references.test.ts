import assert from "node:assert/strict";
import test from "node:test";
import { alignReferenceViews, decodeReference, REFERENCE_SIZE } from "../server/character-references.ts";
import { REFERENCE_VIEWS, type ReferenceView } from "../src/lib/character.ts";
import { pngFixture } from "./helpers/png.ts";

function character(w: number, h: number, left: number, top: number, width: number, height: number, transparent = false) {
  const pixels: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    pixels.push(...(x >= left && x < left + width && y >= top && y < top + height
      ? [190, 40, 20, 255] : transparent ? [0, 0, 0, 0] : [0, 177, 64, 255]));
  }
  return pngFixture(w, h, pixels);
}

test("different canvas sizes, positions and proportions produce exactly aligned silhouettes without stretching", async () => {
  const sources = {
    side: character(70, 80, 9, 6, 12, 60),
    front: character(90, 90, 48, 35, 24, 40, true),
    back: character(120, 100, 50, 21, 30, 55),
  };
  const original = Buffer.from(sources.side);
  const result = await alignReferenceViews(sources);
  assert.deepEqual(sources.side, original);
  const measured = [];
  for (const view of REFERENCE_VIEWS) {
    const { w, h, pixels } = await decodeReference(result.images[view]);
    assert.equal(w, REFERENCE_SIZE);
    assert.equal(h, REFERENCE_SIZE);
    let left = w, top = h, right = -1, bottom = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!pixels[i + 3]) continue;
      assert.deepEqual([...pixels.subarray(i, i + 4)], [190, 40, 20, 255]);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    assert.equal((left + right + 1) / 2, REFERENCE_SIZE / 2);
    assert.equal(top, result.alignment.top);
    assert.equal(bottom - top + 1, result.alignment.height);
    measured.push(right - left + 1);
  }
  assert.ok(measured[0] < measured[1], "different view widths remain proportional");
});

test("empty, clipped and invalid references fail instead of publishing a misleading aligned set", async () => {
  for (const bad of [pngFixture(2, 2, Array(16).fill(0)), character(8, 8, 0, 0, 8, 8), Buffer.from("not png")]) {
    const sources = Object.fromEntries(REFERENCE_VIEWS.map(view => [view, bad])) as Record<ReferenceView, Buffer>;
    await assert.rejects(alignReferenceViews(sources), /visible character|image edge|dimensions/);
  }
});
