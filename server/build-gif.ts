import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { activeSpriteDir, PROJECT_FILES, ensureInsideRoot } from "./files.js";

export async function buildPreviewGif(
  spritesheet: string,
  frameCount: number,
  outputDir: string,
  fps = 12,
): Promise<string> {
  if (!Number.isInteger(frameCount) || frameCount < 1) throw new Error("Invalid GIF frame count");
  const source = path.join(activeSpriteDir(), spritesheet);
  ensureInsideRoot(source);

  const outputPath = path.join(activeSpriteDir(), outputDir, PROJECT_FILES.previewGif);
  ensureInsideRoot(outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });

  // Read the saved cells in order so the preview reflects output size, padding and selection.
  // Limit the input before palette generation; palettegen buffers until it reaches EOF.
  const filter =
    `trim=end_frame=${frameCount},crop=ih:ih:mod(n\\,${frameCount})*ih:0,scale=200:200:flags=neighbor,` +
    "split [a][b]; [a] palettegen=reserve_transparent=on [p]; [b][p] paletteuse=dither=bayer:bayer_scale=5";

  try {
    await new Promise<void>((resolve, reject) => {
      const args = [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-framerate", String(fps),
        "-loop", "1",
        "-i", source,
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
  } catch (err) {
    await rm(outputPath, { force: true });
    throw err;
  }

  return `${outputDir}/${PROJECT_FILES.previewGif}`;
}
