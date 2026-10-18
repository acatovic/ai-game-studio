import { spawn } from "node:child_process";
import { readPngDims } from "./files.js";

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

export function encodeReference(w: number, h: number, pixels: Buffer): Promise<Buffer> {
  return ffmpeg(pixels,
    ["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${w}x${h}`,
      "-i", "pipe:0", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], pixels.length + 100_000);
}
