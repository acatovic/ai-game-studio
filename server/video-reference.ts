import { spawn } from "node:child_process";

// Video inputs need an opaque backdrop matching extract-frames.sh's chroma key.
// Work in memory so the original transparent character reference stays intact.
export async function prepareVideoReference(image: string, canvasSize?: number): Promise<string> {
  let source: Buffer;
  if (image.startsWith("data:")) {
    const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(image);
    if (!match) throw new Error("unsupported image data URL");
    source = Buffer.from(match[1], "base64");
  } else {
    const response = await fetch(image);
    if (!response.ok) throw new Error(`Reference image download failed: HTTP ${response.status}`);
    source = Buffer.from(await response.arrayBuffer());
  }

  const png = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
      "-filter_complex",
      "[0:v]format=rgba," +
        // Pin scale's output to RGBA: otherwise FFmpeg can negotiate RGB24 from
        // the background branch and discard alpha before the green composite.
        (canvasSize ? `scale=${canvasSize}:${canvasSize}:force_original_aspect_ratio=decrease:flags=neighbor,format=rgba,` +
          `pad=${canvasSize}:${canvasSize}:(ow-iw)/2:(oh-ih)/2:color=0x00b140,` : "") +
        "split[foreground][background];" +
        "[background]format=rgb24,lutrgb=r=0:g=177:b=64[green];" +
        "[green][foreground]overlay=format=rgb,format=rgb24",
      "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.resume();
    child.on("error", (err: NodeJS.ErrnoException) => {
      reject(new Error(err.code === "ENOENT" ? "ffmpeg is not installed" : "Video reference preparation failed"));
    });
    child.stdin.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EPIPE") reject(new Error("Video reference preparation failed"));
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error("Video reference preparation failed: unsupported or invalid image"));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(source);
  });
  return `data:image/png;base64,${png.toString("base64")}`;
}
