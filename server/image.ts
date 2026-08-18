// Image generation via OpenRouter's dedicated Images API.

import { spawn } from "node:child_process";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export const IMAGE_MODELS = [
  { id: "openai/gpt-image-2", label: "OpenAI GPT Image 2" },
  { id: "x-ai/grok-imagine-image-2.0", label: "xAI Grok Imagine Image 2.0" },
] as const;

export type ImageModelId = (typeof IMAGE_MODELS)[number]["id"];

export const DEFAULT_IMAGE_MODEL: ImageModelId = "openai/gpt-image-2";

export function isImageModelId(value: unknown): value is ImageModelId {
  return typeof value === "string" && IMAGE_MODELS.some((model) => model.id === value);
}

const CHROMA_DIRECTIVE =
  "Place the subject on a perfectly flat solid pure chroma green background, " +
  "hex #00b140 (RGB 0, 177, 64). The background must be one uniform color " +
  "with no gradients, no shadows, no lighting variation, and no texture. " +
  "The subject itself must contain no green elements that could conflict " +
  "with chroma keying. Centered, full subject visible.";

interface ImageGenerationResponse {
  data?: Array<{
    b64_json?: string;
    media_type?: string;
  }>;
  error?: { message?: string; code?: string | number } | string;
}

function isPng(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export async function normalizeImageToPng(
  base64: string,
  declaredMediaType?: string,
): Promise<string> {
  const source = Buffer.from(base64, "base64");
  if (isPng(source)) return base64;

  if (!isJpeg(source)) {
    const format = declaredMediaType ?? "unknown format";
    throw new Error(`OpenRouter returned unsupported image format: ${format}`);
  }

  const png = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let stderr = "";
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      const message = "code" in err && err.code === "ENOENT" ? "ffmpeg is not installed" : err.message;
      reject(new Error(`JPEG to PNG conversion failed: ${message}`));
    });
    child.stdin.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code !== "EPIPE") reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `JPEG to PNG conversion failed${stderr.trim() ? `: ${stderr.trim()}` : ` (ffmpeg exited with ${code})`}`,
          ),
        );
        return;
      }
      const output = Buffer.concat(chunks);
      if (!isPng(output)) {
        reject(new Error("JPEG to PNG conversion did not produce a PNG"));
        return;
      }
      resolve(output);
    });

    child.stdin.end(source);
  });

  return png.toString("base64");
}

export async function generateSpriteImage(
  prompt: string,
  model: ImageModelId = DEFAULT_IMAGE_MODEL,
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const fullPrompt = `${prompt.trim()}\n\n${CHROMA_DIRECTIVE}`;

  const res = await fetch(`${OPENROUTER_BASE}/images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, prompt: fullPrompt }),
  });

  const json = (await res.json().catch(() => ({}))) as ImageGenerationResponse;

  if (!res.ok) {
    const message =
      typeof json.error === "string"
        ? json.error
        : json.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`OpenRouter image generation failed: ${message}`);
  }

  const image = json.data?.[0];
  if (!image?.b64_json) {
    throw new Error("OpenRouter response did not include an image");
  }

  return normalizeImageToPng(image.b64_json, image.media_type);
}
