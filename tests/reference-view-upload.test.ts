import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ProjectView } from "../src/lib/api.ts";
import { REFERENCE_VIEWS } from "../src/lib/character.ts";
import { pngFixture } from "./helpers/png.ts";

test("uploaded views work without character generation and a later generation replaces them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-uploaded-views-"));
  const requests = path.join(root, "requests.jsonl");
  const child = spawn(process.execPath,
    ["--import", "tsx", "--import", "./tests/helpers/character-provider.ts", "server/index.ts"], {
      env: { ...process.env, PORT: "0", AI_GAME_STUDIO_HOME: root, OPENROUTER_API_KEY: "fixture-key",
        STUDIO_TEST_REQUESTS: requests }, stdio: ["ignore", "pipe", "pipe"],
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
    const post = async (route: string, body: unknown) => fetch(base + route,
      { method: "POST", headers, body: JSON.stringify(body) });
    const ok = async (route: string, body: unknown): Promise<ProjectView> => {
      const response = await post(route, body);
      const json = await response.json();
      assert.equal(response.status, 200, JSON.stringify(json));
      return json as ProjectView;
    };
    const pixels: number[] = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      pixels.push(...(x >= 8 && x < 24 && y >= 4 && y < 28
        ? [180, 30, 60, 255] : [0, 0, 0, 0]));
    }
    const png = pngFixture(32, 32, pixels);
    const jpeg = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0",
      "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { input: png });
    assert.equal(jpeg.status, 0);
    const images = {
      side: { name: "right.png", dataUrl: `data:image/png;base64,${png.toString("base64")}` },
      "side-left": { name: "left.png", dataUrl: `data:image/png;base64,${png.toString("base64")}` },
      front: { name: "front.jpg", dataUrl: `data:image/jpeg;base64,${jpeg.stdout.toString("base64")}` },
      back: { name: "back.png", dataUrl: `data:image/png;base64,${png.toString("base64")}` },
    };
    await ok("/api/projects/new", { name: "demo" });
    headers["X-Project-Name"] = "demo";
    let view = await ok("/api/projects/sprites/new", { value: "hero" });
    headers["X-Sprite-Id"] = "hero";
    assert.equal(view.spriteUrl, null);
    assert.deepEqual(view.referenceViews, {});
    for (const referenceView of REFERENCE_VIEWS) {
      view = await ok("/api/sprites/reference-view", { view: referenceView, image: images[referenceView] });
      assert.ok(view.referenceViews[referenceView]);
    }
    assert.deepEqual(Object.keys(view.referenceViews), [...REFERENCE_VIEWS]);
    assert.equal(view.spriteUrl, view.referenceViews.side);
    assert.deepEqual(view.spriteDimensions, { w: 32, h: 32 });
    assert.equal(view.referenceAlignment, null);
    assert.deepEqual(view.imageSources.filter(source => source.source.kind === "reference")
      .map(source => source.label), ["Side Right", "Side Left", "Front", "Back"]);
    const reopened = await (await fetch(base + "/api/projects/current", { headers })).json() as ProjectView;
    assert.deepEqual(reopened.referenceViews, view.referenceViews);
    const frontPng = Buffer.from(await (await fetch(base + view.referenceViews.front)).arrayBuffer());
    assert.equal(frontPng.toString("ascii", 1, 4), "PNG", "JPEG imports are saved as PNG for animations");
    const uploadedPaths = { ...view.referenceViews };
    const beforeVideo = await readFile(requests, "utf8").catch(() => "");
    assert.equal(beforeVideo, "", "uploading views never contacts the image provider");
    assert.equal((await post("/api/sprites/reference-view", { view: "other", image: images.side })).status, 400);

    await ok("/api/projects/animations/new", { value: "walk" });
    headers["X-Animation-Id"] = "walk";
    const selected = await ok("/api/projects/draft", {
      spritePrompt: "", spriteModel: "openai/gpt-image-2.5-flare", motionPrompt: "walk left",
      motionModel: "minimax/hailuo-3", startImage: { kind: "reference", view: "side-left" },
      endImage: { kind: "reference", view: "back" },
    });
    assert.ok(selected.startImage?.url);
    assert.ok(selected.endImage?.url);
    const animated = await ok("/api/sprites/animate", { text: "walk left", model: "minimax/hailuo-3" });
    assert.ok(animated.frames.length);
    const providerCalls = (await readFile(requests, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].url, "https://openrouter.ai/api/v1/videos");

    const generatedResponse = await post("/api/sprites/generate", { prompt: "red hero" });
    assert.equal(generatedResponse.status, 200);
    const generated = ((await generatedResponse.json()) as { view: ProjectView }).view;
    for (const referenceView of REFERENCE_VIEWS) {
      assert.notEqual(generated.referenceViews[referenceView], uploadedPaths[referenceView]);
    }
    const imageCalls = (await readFile(requests, "utf8")).trim().split("\n").map(line => JSON.parse(line))
      .filter(call => call.url === "https://openrouter.ai/api/v1/images");
    assert.equal(imageCalls.length, 1);
    assert.equal(imageCalls[0].body.input_references.length, 1,
      "only the layout template is sent; uploaded views are never passed into character generation");
    assert.equal(generated.spriteUrl, generated.referenceViews.side);
    assert.ok(generated.animations.length, "character regeneration retains animations");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit"); child.kill(); await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
