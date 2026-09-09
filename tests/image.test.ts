import assert from "node:assert/strict";
import test from "node:test";
import { generateSpriteImage, DEFAULT_IMAGE_MODEL, isImageModelId } from "../server/image.ts";
import { DEFAULT_IMAGE_MODEL as CLIENT_DEFAULT } from "../src/lib/state.ts";
import { emptyManifest } from "../server/projects.ts";

// Transparent 1x1 PNG: normalization must preserve the exact encoded bytes.
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";

test("Flare defaults request medium-quality PNG with automatic background through OpenRouter", async t => {
  const oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldKey;
  });
  const requests: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "https://openrouter.ai/api/v1/images");
    assert.equal(init.method, "POST");
    requests.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ data: [{ b64_json: png, media_type: "image/png" }] }));
  });
  assert.equal(DEFAULT_IMAGE_MODEL, "openai/gpt-image-2.5-flare");
  assert.equal(CLIENT_DEFAULT, DEFAULT_IMAGE_MODEL);
  assert.equal(emptyManifest("test").spriteModel, DEFAULT_IMAGE_MODEL);
  assert.ok(isImageModelId(DEFAULT_IMAGE_MODEL));
  assert.equal(await generateSpriteImage("  Green slime hero  "), png);
  const request = requests[0];
  assert.equal(request.model, DEFAULT_IMAGE_MODEL);
  assert.equal(request.quality, "medium");
  assert.equal(request.background, "auto");
  assert.equal(request.output_format, "png");
  assert.equal(request.prompt, "Green slime hero");
  assert.doesNotMatch(request.prompt as string, /#00b140|no green elements/);

  for (const model of ["openai/gpt-image-2", "x-ai/grok-imagine-image-2.0"] as const) {
    assert.equal(await generateSpriteImage("hero", model), png);
    const legacy = requests.at(-1)!;
    assert.equal(legacy.model, model);
    assert.match(legacy.prompt as string, /#00b140/);
    assert.equal(legacy.background, undefined);
    assert.equal(legacy.quality, undefined);
  }
});
