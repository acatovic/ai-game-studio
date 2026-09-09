import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { prepareVideoReference } from "../server/video-reference.ts";
import { generateSpriteMotionVideo } from "../server/video.ts";

function ffmpeg(input: Buffer, args: string[]): Buffer {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { input });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}

const pixels = Buffer.from([255, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 128]);
function reference(): string {
  const png = ffmpeg(pixels, ["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "3x1", "-i", "pipe:0", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"]);
  return `data:image/png;base64,${png.toString("base64")}`;
}
function decode(image: string): Buffer {
  return ffmpeg(Buffer.from(image.split(",")[1], "base64"), ["-i", "pipe:0", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"]);
}

test("video reference composites transparency onto green, preserves black details and blends edges", async () => {
  const original = reference();
  const output = decode(await prepareVideoReference(original));
  assert.equal(output.length, pixels.length);
  assert.deepEqual([...output.subarray(0, 8)], [0, 177, 64, 255, 0, 0, 0, 255]);
  assert.ok(Math.abs(output[8] - 128) <= 1);
  assert.ok(Math.abs(output[9] - 216) <= 1);
  assert.ok(Math.abs(output[10] - 160) <= 1);
  assert.equal(output[11], 255);
  assert.deepEqual(decode(original), pixels);
});

test("video submission sends the prepared reference to OpenRouter", async t => {
  const original = reference();
  const key = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  t.after(() => {
    if (key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = key;
  });
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://openrouter.ai/api/v1/videos");
    const body = JSON.parse(init.body as string);
    assert.deepEqual([...decode(body.input_references[0].image_url.url).subarray(0, 4)], [0, 177, 64, 255]);
    assert.match(body.prompt, /pixel-art style/);
    return new Response(JSON.stringify({ id: "test", status: "completed", unsigned_urls: ["https://example.com/video.mp4"] }));
  });
  await generateSpriteMotionVideo(original, "idle breathing");
});
