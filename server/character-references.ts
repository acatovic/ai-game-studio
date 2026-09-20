import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { REFERENCE_VIEWS, type ReferenceView } from "../src/lib/character.js";
import { readPngDims, spriteFile } from "./files.js";
import { generateSpriteImage, type ImageModelId } from "./image.js";

export const REFERENCE_SIZE = 1024;
const MAX_PIXELS = 16_777_216;

async function ffmpeg(input: Buffer, args: string[], maxOutput: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args],
      { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let length = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error("Reference processing timed out")); }, 30_000);
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > maxOutput) { child.kill(); reject(new Error("Reference image is too large")); }
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.stdin.on("error", () => { /* Report via close/error. */ });
    child.on("error", () => { clearTimeout(timer); reject(new Error("Could not start ffmpeg to align references")); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error("Could not process reference image"));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input);
  });
}

export async function decodeReference(png: Buffer) {
  const dims = readPngDims(png);
  if (!dims || dims.w < 1 || dims.h < 1 || dims.w * dims.h > MAX_PIXELS) {
    throw new Error("Invalid reference image dimensions");
  }
  const pixels = await ffmpeg(png, ["-i", "pipe:0", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
    dims.w * dims.h * 4);
  if (pixels.length !== dims.w * dims.h * 4) throw new Error("Incomplete reference image");
  return { ...dims, pixels };
}

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
  const images = await Promise.all(REFERENCE_VIEWS.map(async view => foreground(await decodeReference(sources[view]))));
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
    aligned[REFERENCE_VIEWS[index]] = await ffmpeg(rgba,
      ["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${REFERENCE_SIZE}x${REFERENCE_SIZE}`,
        "-i", "pipe:0", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], rgba.length + 100_000);
  }
  return { images: aligned, alignment: { canvasSize: REFERENCE_SIZE, height, top, centerX: REFERENCE_SIZE / 2 } };
}

const VIEW_PROMPTS: Record<ReferenceView, string> = {
  side: "Strict side profile, facing RIGHT (left-to-right).",
  front: "Strict FRONT view, facing directly toward the viewer.",
  back: "Strict BACK view, facing directly away from the viewer; show the back of the head and clothing.",
};
const DIRECTIVE =
  "Produce exactly ONE full-body character in a neutral standing pose, arms relaxed. " +
  "Orthographic game reference, no perspective, no text, no labels, no shadows, no floor. " +
  "Keep the full character and every accessory inside the image with a generous empty margin. " +
  "Use a perfectly flat solid chroma green #00b140 backdrop, with no green on the character. ";

export async function generateCharacterReferences(prompt: string, model: ImageModelId, referenceImage?: string) {
  const appearance = referenceImage
    ? "Use the uploaded reference image for the character's appearance and identity, applying the text prompt's requested details and changes. "
    : "";
  const side = await generateSpriteImage(`${prompt}\n\n${appearance}${DIRECTIVE}${VIEW_PROMPTS.side}`, model,
    referenceImage ? [referenceImage] : []);
  const reference = `data:image/png;base64,${side}`;
  // Sequential calls keep provider concurrency modest and avoid orphan requests on failure.
  const sources = { side: Buffer.from(side, "base64") } as Record<ReferenceView, Buffer>;
  for (const view of ["front", "back"] as const) {
    const base64 = await generateSpriteImage(
      `${prompt}\n\n${appearance}${DIRECTIVE}${VIEW_PROMPTS[view]} ` +
      "Rotate the character from the first supplied image (the generated side view) to this view. " +
      (referenceImage ? "The second image is the uploaded appearance reference; keep its defining details while following the text prompt. " : "") +
      "Preserve the exact identity, anatomy, costume, " +
      "accessories, colors, proportions, pixel-art style and neutral pose. Do not redesign the character.",
      model, referenceImage ? [reference, referenceImage] : [reference]);
    sources[view] = Buffer.from(base64, "base64");
  }
  const normalized = await alignReferenceViews(sources);
  const revision = `references/${randomUUID()}`;
  const directory = spriteFile(revision);
  await mkdir(directory, { recursive: true });
  try {
    for (const view of REFERENCE_VIEWS) {
      await writeFile(path.join(directory, `${view}-original.png`), sources[view]);
      await writeFile(path.join(directory, `${view}.png`), normalized.images[view]);
    }
  } catch (err) {
    await rm(directory, { recursive: true, force: true });
    throw err;
  }
  return {
    directory,
    referenceViews: Object.fromEntries(REFERENCE_VIEWS.map(view => [view, `${revision}/${view}.png`])) as Record<ReferenceView, string>,
    referenceAlignment: normalized.alignment,
    spriteDimensions: { w: REFERENCE_SIZE, h: REFERENCE_SIZE },
    dataUrl: `data:image/png;base64,${normalized.images.side.toString("base64")}`,
  };
}
