import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractReferenceSheet } from "../server/reference-sheet.ts";
import { alignReferenceViews, decodeReference } from "../server/character-references.ts";
import { REFERENCE_VIEWS } from "../src/lib/character.ts";
import { referenceSheetFixture, SHEET_COLORS } from "./helpers/reference-sheet.ts";
import { pngFixture } from "./helpers/png.ts";

test("sheet crops map every view correctly at different resolutions and exclude labels and borders", async () => {
  for (const size of [256, 514]) {
    const sheet = referenceSheetFixture(size);
    const before = Buffer.from(sheet);
    const sources = await extractReferenceSheet(sheet);
    assert.deepEqual(sheet, before, "preserve the provider original");
    for (const view of REFERENCE_VIEWS) {
      const { w, h, pixels } = await decodeReference(sources[view]);
      assert.ok(Math.abs(w - size / 2) <= 1);
      assert.ok(Math.abs(h - size / 2) <= 1);
      const colors = new Set<string>();
      for (let i = 0; i < pixels.length; i += 4) colors.add([...pixels.subarray(i, i + 4)].join(","));
      assert.deepEqual([...colors].sort(), ["0,0,0,0", SHEET_COLORS[view].join(",")].sort(),
        `${view} contains only its own character and backdrop`);
    }
    const aligned = await alignReferenceViews(sources);
    for (const view of REFERENCE_VIEWS) {
      const { w, h, pixels } = await decodeReference(aligned.images[view]);
      assert.equal(w, 1024);
      assert.equal(h, 1024);
      assert.deepEqual([...pixels.subarray((512 * w + 512) * 4, (512 * w + 512) * 4 + 4)], SHEET_COLORS[view]);
      assert.equal(pixels[3], 0, "aligned canvases are transparent");
    }
  }
});

test("invalid layouts, missing views and characters crossing crop edges fail extraction or alignment", async () => {
  for (const [w, h] of [[256, 128], [64, 64]]) {
    await assert.rejects(extractReferenceSheet(pngFixture(w, h, Array(w * h * 4).fill(0))), /square image at least/);
  }
  await assert.rejects(extractReferenceSheet(Buffer.from("not a png")), /dimensions/);
  for (const bad of ["empty", "clipped"] as const) {
    await assert.rejects(async () => alignReferenceViews(await extractReferenceSheet(referenceSheetFixture(256, bad))),
      /visible character|image edge/);
  }
});

test("drifting labels, inset guide lines and a different green do not clip characters or contaminate alignment", async () => {
  const size = 512, cell = size / 2;
  const sheet = await decodeReference(referenceSheetFixture(size));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 4;
    const cx = x % cell, cy = y % cell;
    const color = sheet.pixels.subarray(offset, offset + 4);
    if (color[0] === 0 && color[1] === 177) sheet.pixels.set([0, 255, 0, 255], offset);
    // A shifted label below the old fixed header cut, plus dark rules inside
    // the old crop. None belongs to the character silhouette.
    if ((cx >= 70 && cx < 95 && cy >= 28 && cy < 44)
      || (cx === 8 && cy >= 24 && cy <= 248)
      || (cy === 48 && cx > 5 && cx < 250)) sheet.pixels.set([10, 10, 10, 255], offset);
    // Disconnected accessory outside the original body bounds.
    if (cx >= 178 && cx < 188 && cy >= 120 && cy < 155) sheet.pixels.set([220, 180, 30, 255], offset);
    // Feet below the old 97% crop, with a real empty margin before the cell edge.
    if (cx >= 120 && cx < 136 && cy >= 220 && cy < 252) sheet.pixels.set([200, 60, 20, 255], offset);
  }
  const sources = await extractReferenceSheet(pngFixture(size, size, [...sheet.pixels]));
  for (const view of REFERENCE_VIEWS) {
    const { pixels, w } = await decodeReference(sources[view]);
    const at = (x: number, y: number) => [...pixels.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
    assert.deepEqual(at(80, 35), [0, 0, 0, 0], "remove the shifted label");
    assert.deepEqual(at(8, 100), [0, 0, 0, 0], "remove the inset guide");
    assert.deepEqual(at(180, 140), [220, 180, 30, 255], "retain detached accessories");
    assert.deepEqual(at(125, 250), [200, 60, 20, 255], "retain feet beyond the old crop");
  }
  await alignReferenceViews(sources);
});

test("standalone extraction script saves four normalized PNGs and retains the sheet and original crops", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-sheet-script-"));
  try {
    const sheet = referenceSheetFixture();
    const input = path.join(directory, "sheet.png");
    const output = path.join(directory, "extracted");
    await writeFile(input, sheet);
    const run = () => new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "scripts/extract-reference-sheet.ts", input, output],
        { stdio: "ignore" });
      child.on("error", reject);
      child.on("exit", resolve);
    });
    assert.equal(await run(), 0);
    assert.deepEqual(await readFile(path.join(output, "sheet-original.png")), sheet);
    assert.equal((await readdir(output)).length, 10);
    for (const view of REFERENCE_VIEWS) {
      const png = await decodeReference(await readFile(path.join(output, `${view}.png`)));
      assert.equal(png.w, 1024);
      assert.equal(png.h, 1024);
    }
    assert.notEqual(await run(), 0, "the script refuses to overwrite an existing output directory");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
