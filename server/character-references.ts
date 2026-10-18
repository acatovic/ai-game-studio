import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { REFERENCE_LABELS, REFERENCE_VIEWS, type ReferenceView } from "../src/lib/character.js";
import { spriteFile } from "./files.js";
import { generateSpriteImage, type ImageModelId } from "./image.js";
import { decodeReference, encodeReference } from "./reference-pixels.js";
import { extractReferenceSheet, referenceSheetTemplate, REFERENCE_SHEET_DIRECTIVE } from "./reference-sheet.js";
export { decodeReference } from "./reference-pixels.js";

export const REFERENCE_SIZE = 1024;

function foreground(image: Awaited<ReturnType<typeof decodeReference>>) {
  const { w, h, pixels } = image;
  // The generation prompt reserves chroma green for the backdrop. Keep true alpha
  // when present, and remove the chroma background from opaque provider results.
  let left = w, right = -1, top = h, bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b] = pixels.subarray(i, i + 3);
      if (Math.hypot(r, g - 177, b - 64) < 90 && g > r * 1.35 && g > b * 1.3) pixels[i + 3] = 0;
      if (pixels[i + 3] < 16) { pixels[i + 3] = 0; continue; }
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) throw new Error("Reference has no visible character");
  if (left === 0 || top === 0 || right === w - 1 || bottom === h - 1) {
    throw new Error("Reference touches the image edge or lacks a clear backdrop. Regenerate with the full character visible.");
  }
  return { ...image, left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** Normalize actual foreground bounds, never the provider's canvas bounds. */
export async function alignReferenceViews(sources: Record<ReferenceView, Buffer>) {
  const images = await Promise.all(REFERENCE_VIEWS.map(async view => {
    try { return foreground(await decodeReference(sources[view])); }
    catch (error) { throw new Error(`${REFERENCE_LABELS[view]}: ${error instanceof Error ? error.message : String(error)}`); }
  }));
  // One height for every view; allow wide characters without clipping or stretching.
  const maxWidthRatio = Math.max(...images.map(image => image.width / image.height));
  const height = Math.min(820, Math.floor(820 / maxWidthRatio));
  if (height < 64) throw new Error("Reference proportions are too wide to align");
  const top = Math.floor((REFERENCE_SIZE - height) / 2);
  const aligned = {} as Record<ReferenceView, Buffer>;
  for (const [index, image] of images.entries()) {
    // Even widths give each view precisely the same horizontal center.
    const width = Math.max(2, Math.round(image.width / image.height * height / 2) * 2);
    const left = (REFERENCE_SIZE - width) / 2;
    const rgba = Buffer.alloc(REFERENCE_SIZE * REFERENCE_SIZE * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sx = image.left + Math.min(image.width - 1, Math.floor((x + .5) * image.width / width));
        const sy = image.top + Math.min(image.height - 1, Math.floor((y + .5) * image.height / height));
        const source = (sy * image.w + sx) * 4;
        image.pixels.copy(rgba, ((y + top) * REFERENCE_SIZE + left + x) * 4, source, source + 4);
      }
    }
    // Preserve silhouette extrema that nearest-neighbor downsampling could miss
    // (e.g. one-pixel hair tips), so the measured output bounds match exactly.
    for (let sy = 0; sy < image.height; sy++) {
      for (let sx = 0; sx < image.width; sx++) {
        if (sx !== 0 && sx !== image.width - 1 && sy !== 0 && sy !== image.height - 1) continue;
        const offset = ((sy + image.top) * image.w + image.left + sx) * 4;
        if (!image.pixels[offset + 3]) continue;
        const x = Math.round(sx * (width - 1) / Math.max(1, image.width - 1));
        const y = Math.round(sy * (height - 1) / Math.max(1, image.height - 1));
        image.pixels.copy(rgba, ((y + top) * REFERENCE_SIZE + left + x) * 4, offset, offset + 4);
      }
    }
    aligned[REFERENCE_VIEWS[index]] = await encodeReference(REFERENCE_SIZE, REFERENCE_SIZE, rgba);
  }
  return { images: aligned, alignment: { canvasSize: REFERENCE_SIZE, height, top, centerX: REFERENCE_SIZE / 2 } };
}

const UPLOADED_REFERENCE_DIRECTIVE =
  "Create the character described in the text prompt. The text prompt takes priority over conflicting image content " +
  "for the subject, species, anatomy, clothing, colors and art style. " +
  "Use the uploaded image only for the aspects requested in the text. " +
  "For a style or aesthetic reference, borrow the rendering technique, linework, texture and mood; " +
  "do not copy unrequested subjects or their identity. " +
  "Use a depicted character's identity only when the text requests that character, and apply all requested changes. " +
  "If the image contains multiple subjects, follow the text to select the intended subject; " +
  "do not default to the largest or most prominent figure. ";

export async function generateCharacterReferences(
  prompt: string, model: ImageModelId, referenceImage?: string,
) {
  const description = `Character description:\n${prompt.trim()}\n\n`;
  const referenceGuidance = referenceImage ? UPLOADED_REFERENCE_DIRECTIVE : "";
  const template = await referenceSheetTemplate();
  const sheet = Buffer.from(await generateSpriteImage(
    `${description}${referenceGuidance}${REFERENCE_SHEET_DIRECTIVE}`, model,
    [template.dataUrl, ...(referenceImage ? [referenceImage] : [])]), "base64");
  const revision = `references/${randomUUID()}`;
  const directory = spriteFile(revision);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, "sheet-original.png"), sheet);
    await writeFile(path.join(directory, "sheet-template.png"), template.bytes);
  } catch (err) {
    await rm(directory, { recursive: true, force: true });
    throw err;
  }
  let normalized: Awaited<ReturnType<typeof alignReferenceViews>>;
  try {
    const sources = await extractReferenceSheet(sheet);
    for (const view of REFERENCE_VIEWS) {
      await writeFile(path.join(directory, `${view}-original.png`), sources[view]);
    }
    normalized = await alignReferenceViews(sources);
    for (const view of REFERENCE_VIEWS) {
      await writeFile(path.join(directory, `${view}.png`), normalized.images[view]);
    }
  } catch (err) {
    // Keep paid provider output available for inspection and local reprocessing.
    // Nothing points at this revision until every view has succeeded.
    const message = err instanceof Error ? err.message : "Could not extract the character views";
    throw new Error(`${message} The original sheet was retained in ${revision}/sheet-original.png.`);
  }
  return {
    directory,
    referenceViews: Object.fromEntries(REFERENCE_VIEWS.map(view => [view, `${revision}/${view}.png`])) as Record<ReferenceView, string>,
    referenceAlignment: normalized.alignment,
    spriteDimensions: { w: REFERENCE_SIZE, h: REFERENCE_SIZE },
    dataUrl: `data:image/png;base64,${normalized.images.side.toString("base64")}`,
  };
}
