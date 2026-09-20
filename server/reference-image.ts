import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { MAX_REFERENCE_IMAGE_BYTES, isReferenceImageFile, referenceImageType, type ReferenceImageType } from "../src/lib/reference-image.js";
import { spriteFile } from "./files.js";

export interface SavedReferenceImage { name: string; path: string; type: ReferenceImageType }

/** Decode before saving: a file extension or MIME label alone is not sufficient. */
async function validateImage(bytes: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-xerror",
      "-max_pixels", "16777216", "-i", "pipe:0", "-frames:v", "1", "-vf", "scale=1:1",
      "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
    let length = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error("Reference image processing timed out")); }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => { length += chunk.length; });
    child.stderr.resume();
    child.stdin.on("error", () => { /* Report process failures below. */ });
    child.on("error", () => { clearTimeout(timer); reject(new Error("Could not process reference image")); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0 || length !== 4) reject(new Error("Invalid reference image"));
      else resolve();
    });
    child.stdin.end(bytes);
  });
}

export async function stageReferenceImage(value: unknown): Promise<SavedReferenceImage | null> {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid reference image");
  const { name, dataUrl } = value as Record<string, unknown>;
  if (typeof name !== "string" || !name || name.length > 255 || typeof dataUrl !== "string"
    || dataUrl.length > Math.ceil(MAX_REFERENCE_IMAGE_BYTES / 3) * 4 + 64) throw new Error("Invalid reference image");
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || !isReferenceImageFile({ name, type: match[1] })) throw new Error("Unsupported reference image format");
  const bytes = Buffer.from(match[2], "base64");
  const type = referenceImageType(bytes);
  if (!type || type !== match[1] || bytes.length > MAX_REFERENCE_IMAGE_BYTES
    || bytes.toString("base64") !== match[2]) throw new Error("Invalid reference image");
  await validateImage(bytes);
  const extension = type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
  const file = `inputs/${randomUUID()}/reference.${extension}`;
  const directory = path.dirname(spriteFile(file));
  await mkdir(directory, { recursive: true });
  try { await writeFile(spriteFile(file), bytes); }
  catch (err) { await rm(directory, { recursive: true, force: true }); throw err; }
  return { name: path.basename(name), path: file, type };
}

export async function referenceImageDataUrl(image: SavedReferenceImage | null): Promise<string | undefined> {
  if (!image) return undefined;
  return `data:${image.type};base64,${(await readFile(spriteFile(image.path))).toString("base64")}`;
}
