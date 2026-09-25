import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { prepareVideoReference } from "../server/video-reference.ts";
import { defaultDurationFor, generateSpriteMotionVideo, VIDEO_MODELS, type VideoModelId } from "../server/video.ts";
import { videoFrameError } from "../src/lib/video-capabilities.ts";
import { pngFixture } from "./helpers/png.ts";

function ffmpeg(input: Buffer, args: string[]): Buffer {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { input, maxBuffer: 16_000_000 });
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

test("endpoint canvas normalization preserves alpha until compositing, including transparent black margins", async () => {
  // Aligned references have transparent black margins and can retain chroma RGB
  // beneath transparent pixels closer to the character.
  for (const height of [4, 8]) {
    const source = Buffer.alloc(8 * height * 4);
    source.set([0, 177, 64, 0], (1 * 8 + 1) * 4);
    source.set([0, 0, 0, 255], (2 * 8 + 3) * 4);
    source.set([255, 255, 255, 128], (2 * 8 + 4) * 4);
    const original = `data:image/png;base64,${pngFixture(8, height, [...source]).toString("base64")}`;
    for (const size of [8, 16, 1024]) {
      const prepared = await prepareVideoReference(original, size);
      const png = Buffer.from(prepared.split(",")[1], "base64");
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
      const output = decode(prepared);
      const scale = size / 8;
      const top = (size - height * scale) / 2;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const sx = Math.floor(x / scale);
        const sy = Math.floor((y - top) / scale);
        const i = (y * size + x) * 4;
        const expected = sy === 2 && sx === 3 ? [0, 0, 0, 255]
          : sy === 2 && sx === 4 ? [128, 216, 160, 255] : [0, 177, 64, 255];
        for (let channel = 0; channel < 4; channel++) {
          if (Math.abs(output[i + channel] - expected[channel]) > 1) {
            assert.fail(`${8}×${height} → ${size}: pixel (${x}, ${y}) is ${[...output.subarray(i, i + 4)]}, expected ${expected}`);
          }
        }
      }
    }
    assert.deepEqual(decode(original), source, "saved poses stay unchanged");
  }
});

for (const model of ["x-ai/grok-imagine-video", "minimax/hailuo-3", "minimax/hailuo-3-max", "bytedance/seedance-2.0"] satisfies VideoModelId[]) {
  test(`${model} leaves the first frame unset when no start image is selected`, async t => {
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
      assert.equal(body.model, model);
      let image: string | undefined;
      assert.equal(body.frame_images, undefined);
      if (model === "minimax/hailuo-3-max") {
        assert.equal(body.duration, 5);
        assert.equal(body.resolution, "480p");
        assert.equal(body.input_references, undefined);
        assert.match(body.prompt, /Character: Red knight/);
      } else {
        assert.equal(body.resolution, undefined);
        image = body.input_references[0].image_url.url;
      }
      if (image) assert.deepEqual([...decode(image).subarray(0, 4)], [0, 177, 64, 255]);
      assert.match(body.prompt, /rendering style/);
      assert.doesNotMatch(body.prompt, /pixel-art style/);
      return new Response(JSON.stringify({ id: "test", status: "completed", unsigned_urls: ["https://example.com/video.mp4"] }));
    });
    assert.deepEqual(
      await generateSpriteMotionVideo(original, "idle breathing", defaultDurationFor(model), model,
        { characterPrompt: "Red knight" }),
      { url: "https://example.com/video.mp4" },
    );
  });
}

for (const model of ["minimax/hailuo-3", "bytedance/seedance-2.0"] satisfies VideoModelId[]) {
  test(`${model} with only an end image never inserts the character reference as a start frame`, async t => {
    const original = reference();
    const key = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-key";
    t.after(() => {
      if (key === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = key;
    });
    t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      assert.deepEqual(body.frame_images.map((frame: { frame_type: string }) => frame.frame_type), ["last_frame"]);
      assert.equal(body.input_references, undefined);
      assert.doesNotMatch(body.prompt, /supplied first frame/);
      assert.match(body.prompt, /natural starting pose/);
      return Response.json({ id: "test", status: "completed", unsigned_urls: ["https://example.com/video.mp4"] });
    });
    // The unused appearance reference must not even be decoded for end-only generation.
    await generateSpriteMotionVideo("unused-reference", "turn north", defaultDurationFor(model), model, { endImage: original });
  });
}

for (const model of ["minimax/hailuo-3", "bytedance/seedance-2.0"] satisfies VideoModelId[]) {
  test(`${model} uses ordered first/last frame images and removes the loop instruction for transitions`, async t => {
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
      assert.equal(body.input_references, undefined);
      assert.deepEqual(body.frame_images.map((frame: { frame_type: string }) => frame.frame_type), ["first_frame", "last_frame"]);
      for (const frame of body.frame_images) {
        const png = Buffer.from(frame.image_url.url.split(",")[1], "base64");
        assert.equal(png.readUInt32BE(16), 1024);
        assert.equal(png.readUInt32BE(20), 1024);
      }
      assert.doesNotMatch(body.prompt, /Create a seamless cycle/);
      assert.match(body.prompt, /exact ending pose/);
      return Response.json({ id: "test", status: "completed", unsigned_urls: ["https://example.com/video.mp4"] });
    });
    await generateSpriteMotionVideo(original, "turn north", defaultDurationFor(model), model,
      { startImage: original, endImage: original });
  });
}

for (const hasStartImage of [false, true]) {
  test(`H3 Max rejects an end image ${hasStartImage ? "with" : "without"} a start before preparing images or contacting OpenRouter`, async t => {
    const key = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-key";
    t.after(() => {
      if (key === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = key;
    });
    t.mock.method(globalThis, "fetch", async () => { assert.fail("Unsupported end images must not reach the provider"); });
    await assert.rejects(generateSpriteMotionVideo("unused", "turn", 5, "minimax/hailuo-3-max",
      { startImage: hasStartImage ? "invalid-start" : undefined, endImage: "invalid-end" }),
    /H3 Max supports only a start image through OpenRouter.*MiniMax H3 or Seedance/);
  });
}

test("H3 Max still accepts a start image alone", async t => {
  const key = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  t.after(() => {
    if (key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = key;
  });
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    assert.deepEqual(body.frame_images.map((frame: { frame_type: string }) => frame.frame_type), ["first_frame"]);
    assert.equal(body.resolution, "480p");
    assert.equal(body.input_references, undefined);
    return Response.json({ id: "test", status: "completed", unsigned_urls: ["https://example.com/video.mp4"] });
  });
  await generateSpriteMotionVideo("unused", "idle", 5, "minimax/hailuo-3-max", { startImage: reference() });
});

test("shared UI validation distinguishes supported endpoint types from supported pairs", () => {
  const max = VIDEO_MODELS.find(model => model.id === "minimax/hailuo-3-max")!;
  assert.equal(videoFrameError(max, false, false), null);
  assert.equal(videoFrameError(max, true, false), null);
  assert.match(videoFrameError(max, false, true)!, /supports only a start image through OpenRouter/);
  assert.match(videoFrameError(max, true, true)!, /supports only a start image through OpenRouter/);
  // Models may advertise end images while still limiting requests to one frame.
  const single = { label: "Single-keyframe model", supportsEndImage: true, maxKeyframeImages: 1 };
  assert.equal(videoFrameError(single, false, true), null);
  assert.match(videoFrameError(single, true, true)!, /choose a start or an end image, not both/);
  for (const id of ["minimax/hailuo-3", "bytedance/seedance-2.0"]) {
    assert.equal(videoFrameError(VIDEO_MODELS.find(model => model.id === id)!, true, true), null);
  }
});

test("Grok rejects end images before preparing images or contacting the provider", async t => {
  const key = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  t.after(() => {
    if (key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = key;
  });
  t.mock.method(globalThis, "fetch", async () => { assert.fail("Unsupported requests must not reach the provider"); });
  await assert.rejects(generateSpriteMotionVideo("invalid-image", "turn", 2, "x-ai/grok-imagine-video",
    { endImage: "invalid-end" }), /supports only a start image/);
});
