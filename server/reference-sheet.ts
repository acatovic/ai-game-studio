import { readFile } from "node:fs/promises";
import { REFERENCE_LABELS, type ReferenceView } from "../src/lib/character.js";
import { decodeReference, encodeReference } from "./reference-pixels.js";

// Cell positions are relative to the sheet, so provider resolutions need not
// match the 2048px template. Segmentation removes labels and guides within cells.
export const REFERENCE_SHEET_CELLS = [
  { view: "front", column: 0, row: 0 },
  { view: "side-left", column: 1, row: 0 },
  { view: "side", column: 0, row: 1 },
  { view: "back", column: 1, row: 1 },
] as const;

export const REFERENCE_SHEET_DIRECTIVE =
  "Generate ONE square character turnaround sheet containing exactly FOUR full-body views of the SAME character. " +
  "The FIRST supplied image is a blank layout template only, not an appearance reference. " +
  "Follow its equal-sized 2-by-2 grid exactly: top-left FRONT, top-right SIDE LEFT, " +
  "bottom-left SIDE RIGHT, bottom-right BACK. Do not reorder, merge or add cells. " +
  "Retain the labels in the top band of each cell, occupying only the top 10% of that cell. " +
  "If a SECOND image is supplied, it is the uploaded visual guidance; follow the text's instructions for its use. " +
  "FRONT: Strict FRONT view, facing directly toward the viewer. " +
  "SIDE LEFT: Strict side profile, facing LEFT toward the left edge of the sheet. " +
  "SIDE RIGHT: Strict side profile, facing RIGHT toward the right edge of the sheet. " +
  "BACK: Strict BACK view, facing directly away from the viewer. " +
  "Place exactly one complete character inside each cell, centered horizontally, " +
  "below the label band (below 12.5% of the cell height), with generous empty margins on every side. " +
  "Keep all body parts and accessories within the inner 3%-97% of the cell width and above 97% of its height. " +
  "Keep equal character heights, matching baselines relative to each cell, and identical neutral standing poses, arms relaxed. " +
  "Maintain the exact same identity, anatomy, costume, accessories, colors, proportions, art style, linework and texture across ALL four views. " +
  "Keep every asymmetric feature attached to the same anatomical side of the character. " +
  "An item held in the right hand must remain in the right hand; an item held in the left hand must remain in the left hand. " +
  "Rotate the character; do not horizontally flip a view or redesign it. " +
  "Orthographic game references, no perspective, no shadows, no floor, no additional text or decorations. " +
  "Use a perfectly flat solid chroma green #00b140 backdrop in every cell, with no green on the character.";

export async function referenceSheetTemplate() {
  const bytes = await readFile(new URL("../assets/reference-sheet-template.png", import.meta.url));
  return { bytes, dataUrl: `data:image/png;base64,${bytes.toString("base64")}` };
}

interface Component {
  id: number; area: number; interiorArea: number; left: number; top: number; right: number; bottom: number;
}

function visibleComponents(w: number, h: number, pixels: Buffer) {
  const labels = new Uint32Array(w * h);
  const queue = new Int32Array(w * h);
  const components: Component[] = [];
  for (let i = 0; i < w * h; i++) {
    const offset = i * 4;
    const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
    // Providers vary the exact key color; green is reserved for the background.
    if (g > r * 1.35 && g > b * 1.3 && g > 60) pixels[offset + 3] = 0;
    if (pixels[offset + 3] < 16) pixels[offset + 3] = 0;
  }
  for (let seed = 0; seed < w * h; seed++) {
    if (labels[seed] || !pixels[seed * 4 + 3]) continue;
    const part: Component = { id: components.length + 1, area: 0, interiorArea: 0, left: w, top: h, right: -1, bottom: -1 };
    let head = 0, tail = 1;
    queue[0] = seed;
    labels[seed] = part.id;
    const visit = (index: number) => {
      if (labels[index] || !pixels[index * 4 + 3]) return;
      labels[index] = part.id;
      queue[tail++] = index;
    };
    while (head < tail) {
      const index = queue[head++], x = index % w, y = Math.floor(index / w);
      part.area++;
      if (x > w * .2 && x < w * .8 && y > h * .22 && y < h * .9) part.interiorArea++;
      part.left = Math.min(part.left, x); part.right = Math.max(part.right, x);
      part.top = Math.min(part.top, y); part.bottom = Math.max(part.bottom, y);
      if (x > 0) visit(index - 1);
      if (x < w - 1) visit(index + 1);
      if (y > 0) visit(index - w);
      if (y < h - 1) visit(index + w);
    }
    components.push(part);
  }
  return { labels, components };
}

function isGuide(part: Component, w: number, h: number): boolean {
  const width = part.right - part.left + 1, height = part.bottom - part.top + 1;
  // Long thin rules and sparse enclosing rectangles may drift into a cell.
  // Do not confuse a filled character reaching an edge with a grid border.
  if (part.interiorArea > w * h * .01) return false;
  return (width > w * .65 && height < h * .04)
    || (height > h * .65 && width < w * .04)
    || (width > w * .8 && height > h * .8 && part.area / (width * height) < .2);
}

function isolateCharacter(w: number, h: number, pixels: Buffer, view: ReferenceView): Buffer {
  const { labels, components } = visibleComponents(w, h, pixels);
  const candidates = components.filter(part => !isGuide(part, w, h));
  // Labels are small components in the upper band; the main body occupies the
  // center of a cell. Inspect the whole cell rather than cutting off hair/feet
  // at a fixed inset merely because the model moved the character a little.
  const bodies = candidates.filter(part => part.bottom >= h * .3 && part.top < h * .85
    && part.left < w * .7 && part.right > w * .3 && part.bottom - part.top >= h * .3);
  const body = bodies.reduce<Component | undefined>((best, part) => !best || part.area > best.area ? part : best, undefined);
  if (!body || body.area < w * h * .005) throw new Error(`${REFERENCE_LABELS[view]}: Reference has no visible character`);
  const kept = new Set(candidates.filter(part => part.id === body.id || (
    // Keep nearby disconnected hair, hands, accessories and feet. Typography
    // in the header and unrelated border specks stay outside this envelope.
    !(part.bottom < h * .22 && part.bottom - part.top < h * .12)
    && part.bottom >= body.top - h * .08 && part.top <= body.bottom + h * .05
    && part.right >= body.left - w * .15 && part.left <= body.right + w * .15
  )).map(part => part.id));
  const result = Buffer.alloc(pixels.length);
  for (let i = 0; i < w * h; i++) {
    if (kept.has(labels[i])) pixels.copy(result, i * 4, i * 4, i * 4 + 4);
  }
  return result;
}

/** Extract unscaled characters from whole cells, excluding grid and typography. */
export async function extractReferenceSheet(sheet: Buffer): Promise<Record<ReferenceView, Buffer>> {
  const image = await decodeReference(sheet);
  if (image.w !== image.h || image.w < 256) {
    throw new Error("Reference sheet must be a square image at least 256×256. Regenerate using the four-view template.");
  }
  const sources = {} as Record<ReferenceView, Buffer>;
  for (const { view, column, row } of REFERENCE_SHEET_CELLS) {
    const left = Math.round(column * image.w / 2);
    const top = Math.round(row * image.h / 2);
    const right = Math.round((column + 1) * image.w / 2);
    const bottom = Math.round((row + 1) * image.h / 2);
    const w = right - left, h = bottom - top;
    const pixels = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      const offset = ((top + y) * image.w + left) * 4;
      image.pixels.copy(pixels, y * w * 4, offset, offset + w * 4);
    }
    sources[view] = await encodeReference(w, h, isolateCharacter(w, h, pixels, view));
  }
  return sources;
}
