import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");
export const PROJECTS_DIR = path.join(ROOT_DIR, "projects");
export const LATEST_DIR = path.join(PROJECTS_DIR, "latest");

export const PROJECT_FILES = {
  manifest: "sprite.json",
  ref: "ref/sprite.png",
  source: "source.mp4",
  framesDir: "frames",
  spritesheet: "spritesheet.png",
  previewGif: "preview.gif",
} as const;

const SAFE_NAME = /^[a-zA-Z0-9_-]{1,40}$/;

export function safeProjectName(name: string): string {
  if (!SAFE_NAME.test(name)) {
    throw new Error(
      "invalid project name (use letters, numbers, hyphen, underscore — up to 40 chars)",
    );
  }
  if (name === "latest") {
    throw new Error("'latest' is reserved");
  }
  return name;
}

export function projectDir(name: string): string {
  return path.join(PROJECTS_DIR, name);
}

export async function saveBase64Image(base64: string, outputPath: string): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(base64, "base64"));
}

export async function saveDataUrlPng(dataUrl: string, outputPath: string): Promise<void> {
  const match = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!match) throw new Error("invalid data URL");
  await saveBase64Image(match[2], outputPath);
}

export async function downloadVideo(
  url: string,
  outputPath: string,
  headers?: Record<string, string>,
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const res = await fetch(url, headers ? { headers } : undefined);
  if (!res.ok) throw new Error(`video download failed (${res.status})`);
  const arrayBuffer = await res.arrayBuffer();
  await writeFile(outputPath, Buffer.from(arrayBuffer));
}

export function readPngDims(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24) return null;
  if (buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

export function ensureInsideRoot(absolutePath: string): void {
  const resolved = path.resolve(absolutePath);
  if (!resolved.startsWith(ROOT_DIR + path.sep) && resolved !== ROOT_DIR) {
    throw new Error("path outside project root");
  }
}
