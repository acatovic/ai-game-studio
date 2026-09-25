import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { isReferenceImageFile, referenceImageType, REFERENCE_IMAGE_ACCEPT } from "../src/lib/reference-image.ts";
import { pngFixture } from "./helpers/png.ts";

test("upload and clipboard filtering allow only JPEG, PNG and WebP", () => {
  for (const [name, type] of [["hero.jpg", "image/jpeg"], ["hero.JPEG", "image/jpeg"],
    ["image.png", "image/png"], ["hero.webp", "image/webp"], ["hero.PNG", ""]]) {
    assert.equal(isReferenceImageFile({ name, type }), true);
  }
  for (const [name, type] of [["hero.gif", "image/gif"], ["hero.svg", "image/svg+xml"],
    ["hero.bmp", "image/bmp"], ["hero.txt", "image/png"], ["hero.png", "application/pdf"],
    ["hero.heic", "image/heic"], ["hero.png.exe", "image/png"]]) {
    assert.equal(isReferenceImageFile({ name, type }), false);
  }
  assert.equal(referenceImageType(Buffer.from("GIF89a")), null);
  assert.equal(referenceImageType(Buffer.from("<svg></svg>")), null);
  assert.equal(referenceImageType(Buffer.from("%PDF-1.7")), null);
  assert.ok(!REFERENCE_IMAGE_ACCEPT.includes("image/*"));
});

test("reference attachments persist per character and guide creation without overriding the requested subject", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-upload-"));
  const requestsFile = path.join(root, "requests.jsonl");
  const child = spawn(process.execPath, ["--import", "tsx", "--import", "./tests/helpers/character-provider.ts", "server/index.ts"], {
    env: { ...process.env, PORT: "0", AI_GAME_STUDIO_HOME: root, OPENROUTER_API_KEY: "fixture-key",
      STUDIO_TEST_REQUESTS: requestsFile }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Startup timed out")), 10_000);
      child.stdout.on("data", chunk => {
        const port = String(chunk).match(/http:\/\/localhost:(\d+)/)?.[1];
        if (port) { clearTimeout(timer); resolve(`http://localhost:${port}`); }
      });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(stderr)); });
    });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const post = (route: string, body: unknown) => fetch(base + route, { method: "POST", headers, body: JSON.stringify(body) });
    const ok = async (route: string, body: unknown) => {
      const response = await post(route, body);
      const json = await response.json();
      assert.equal(response.status, 200, JSON.stringify(json));
      return json;
    };
    const current = async () => (await fetch(base + "/api/projects/current", { headers })).json();
    const png = pngFixture(4, 4, Array.from({ length: 16 }, () => [200, 20, 60, 255]).flat());
    const toImage = (name: string, type: string, bytes: Buffer) => ({ name, dataUrl: `data:${type};base64,${bytes.toString("base64")}` });
    const input = toImage("reference.png", "image/png", png);
    await ok("/api/projects/new", { name: "demo" });
    headers["X-Project-Name"] = "demo";
    await ok("/api/projects/sprites/new", { value: "hero" });
    assert.equal((await post("/api/sprites/reference-image", { image: input })).status, 400, "explicit character scope required");
    headers["X-Sprite-Id"] = "hero";
    const initial = await ok("/api/sprites/reference-image", { image: input });
    assert.deepEqual(Buffer.from(await (await fetch(base + initial.referenceImage.url)).arrayBuffer()), png);
    assert.equal((await current()).referenceImage.name, "reference.png");
    for (const image of [
      [input, input], { ...input, name: "hero.gif" }, { ...input, dataUrl: "https://example.com/reference.png" },
      toImage("hero.gif", "image/gif", Buffer.from("GIF89a")),
      toImage("hero.png", "image/png", Buffer.from("<svg></svg>")),
      toImage("hero.jpg", "image/jpeg", png),
      toImage("hero.png", "image/png", png.subarray(0, 24)),
    ]) {
      assert.equal((await post("/api/sprites/reference-image", { image })).status, 400);
      assert.deepEqual((await current()).referenceImage, initial.referenceImage, "bad uploads preserve the attachment");
    }
    // All supported formats decode; retain the original encoded bytes and MIME type.
    for (const [name, type, codec] of [["reference.jpg", "image/jpeg", "mjpeg"],
      ["reference.JPEG", "image/jpeg", "mjpeg"]]) {
      const encoded = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0",
        "-frames:v", "1", "-c:v", codec, "-f", "image2pipe", "pipe:1"], { input: png });
      assert.equal(encoded.status, 0, String(encoded.stderr));
      assert.equal(referenceImageType(encoded.stdout), type);
      const saved = await ok("/api/sprites/reference-image", { image: toImage(name, type, encoded.stdout) });
      assert.deepEqual(Buffer.from(await (await fetch(base + saved.referenceImage.url)).arrayBuffer()), encoded.stdout);
      assert.equal((await current()).referenceImage.name, name);
    }
    // Tiny lossless WebP fixture; ffmpeg installations need a decoder, not a WebP encoder.
    const webp = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=", "base64");
    const savedWebp = await ok("/api/sprites/reference-image", { image: toImage("reference.webp", "image/webp", webp) });
    assert.deepEqual(Buffer.from(await (await fetch(base + savedWebp.referenceImage.url)).arrayBuffer()), webp);
    await ok("/api/sprites/reference-image", { image: input });
    const draft = { spritePrompt: "black cat, super cute but not in overly kiddie kinda way, done in ink-and-wash aesthetic similar to the enclosed image, standing in big black boots and purple hoodie",
      spriteModel: "openai/gpt-image-2.5-flare",
      motionPrompt: "", motionModel: "x-ai/grok-imagine-video" };
    await ok("/api/projects/draft", draft);
    await ok("/api/projects/sprites/new", { value: "other" });
    headers["X-Sprite-Id"] = "other";
    assert.equal((await current()).referenceImage, null);
    await ok("/api/projects/sprites/load", { value: "hero" });
    headers["X-Sprite-Id"] = "hero";
    assert.equal((await current()).referenceImage.name, input.name);
    assert.equal((await current()).spritePrompt, draft.spritePrompt);
    const generated = await ok("/api/sprites/generate", { prompt: draft.spritePrompt });
    const calls = (await readFile(requestsFile, "utf8")).trim().split("\n").map(line => JSON.parse(line).body);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0].input_references.map((ref: any) => ref.image_url.url), [input.dataUrl]);
    assert.match(calls[0].prompt, /text prompt takes priority/i);
    assert.match(calls[0].prompt, /style or aesthetic reference/i);
    assert.match(calls[0].prompt, /identity only when the text requests that character/i);
    assert.doesNotMatch(calls[0].prompt, /Use the uploaded reference image for the character's appearance and identity/);
    for (const body of calls) {
      assert.ok(body.prompt.includes(draft.spritePrompt), "preserve the user's complete character description");
      assert.doesNotMatch(body.prompt, /pixel-art style/);
    }
    const sideOriginalUrl = generated.view.referenceViews.side.replace(/side\.png$/, "side-original.png");
    const sideOriginal = Buffer.from(await (await fetch(base + sideOriginalUrl)).arrayBuffer());
    const generatedSide = `data:image/png;base64,${sideOriginal.toString("base64")}`;
    for (const body of calls.slice(1)) {
      assert.deepEqual(body.input_references.map((ref: any) => ref.image_url.url), [generatedSide],
        "other angles must use the generated character, without reintroducing the uploaded subjects");
      assert.match(body.prompt, /sole visual reference for identity and style/);
    }
    assert.equal(generated.view.spritePrompt, draft.spritePrompt);
    assert.equal(generated.view.styleId, null);
    assert.equal(generated.view.referenceStyleId, null);
    assert.equal((await post("/api/sprites/generate", { prompt: "fail-reference" })).status, 400);
    assert.deepEqual((await current()).referenceViews, generated.view.referenceViews);
    assert.equal((await current()).referenceImage.name, input.name);
    await ok("/api/projects/sprites/rename", { value: "renamed" });
    headers["X-Sprite-Id"] = "renamed";
    const renamed = await current();
    assert.match(renamed.referenceImage.url, /sprites\/renamed\/inputs\//);
    assert.deepEqual(Buffer.from(await (await fetch(base + renamed.referenceImage.url)).arrayBuffer()), png);
    await ok("/api/projects/load", { name: "demo" });
    assert.deepEqual((await current()).referenceImage, renamed.referenceImage);
    await ok("/api/sprites/reference-image", { image: null });
    assert.equal((await current()).referenceImage, null);
    await ok("/api/sprites/generate", { prompt: "text only" });
    const lastCalls = (await readFile(requestsFile, "utf8")).trim().split("\n").slice(-3).map(line => JSON.parse(line).body);
    assert.equal(lastCalls[0].input_references, undefined);
    assert.equal(lastCalls[1].input_references.length, 1);
    assert.equal(lastCalls[2].input_references.length, 1);
  } finally {
    child.kill();
    if (child.exitCode === null) await once(child, "exit");
    await rm(root, { recursive: true, force: true });
  }
});
