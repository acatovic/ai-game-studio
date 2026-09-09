import { spawn } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { activeSpriteDir, PROJECT_FILES, ensureInsideRoot } from "./files.js";

export async function buildPreviewGif(
  frames: string[],
  selectedIndices: number[],
  outputDir: string,
  fps = 12,
): Promise<string> {
  const selected = [...selectedIndices].sort((a, b) => a - b).map(i => frames[i]);
  if (selected.some(f => !f)) throw new Error("Invalid GIF frame selection");
  if (selected.length === 0) {
    throw new Error("no frames selected for gif");
  }

  const tmpDir = path.join(activeSpriteDir(), outputDir, ".tmp-gif");
  ensureInsideRoot(tmpDir);
  if (existsSync(tmpDir)) await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  await Promise.all(
    selected.map((name, i) => {
      const src = path.join(activeSpriteDir(), name);
      const dst = path.join(tmpDir, `frame-${String(i + 1).padStart(5, "0")}.png`);
      ensureInsideRoot(src);
      return copyFile(src, dst);
    }),
  );

  const outputPath = path.join(activeSpriteDir(), outputDir, PROJECT_FILES.previewGif);
  if (existsSync(outputPath)) await rm(outputPath);

  // Scale to thumbnail height, then high-quality palette with reserved transparency slot
  const filter =
    "scale=-1:200,split [a][b]; [a] palettegen=reserve_transparent=on [p]; [b][p] paletteuse=dither=bayer:bayer_scale=5";

  try {
    await new Promise<void>((resolve, reject) => {
      const args = [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-framerate", String(fps),
        "-f", "image2",
        "-i", path.join(tmpDir, "frame-%05d.png"),
        "-vf", filter,
        "-loop", "0",
        outputPath,
      ];
      const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg gif exited with ${code}`)),
      );
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  return `${outputDir}/${PROJECT_FILES.previewGif}`;
}
