import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ProjectView } from "../src/lib/api.ts";
import { decodeReference } from "../server/character-references.ts";

test("aligned references and saved endpoint poses survive generations, edits, rename, duplication, deletion and reopen", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-characters-"));
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
    const ok = async (route: string, body: unknown): Promise<ProjectView> => {
      const response = await post(route, body);
      const json = await response.json();
      assert.equal(response.status, 200, JSON.stringify(json));
      return json;
    };
    const bytes = async (url: string) => Buffer.from(await (await fetch(base + url)).arrayBuffer());
    const draft = { spritePrompt: "red hero", spriteModel: "openai/gpt-image-2.5-flare", motionPrompt: "turn north",
      motionModel: "minimax/hailuo-3" };
    await ok("/api/projects/new", { name: "demo" });
    headers["X-Project-Name"] = "demo";
    await ok("/api/projects/sprites/new", { value: "hero" });
    headers["X-Sprite-Id"] = "hero";
    let response = await post("/api/sprites/generate", { prompt: "red hero" });
    assert.equal(response.status, 200);
    const reference = (await response.json()).view as ProjectView;
    assert.deepEqual(Object.keys(reference.referenceViews), ["side", "front", "back"]);
    assert.deepEqual(reference.spriteDimensions, { w: 1024, h: 1024 });
    assert.equal(reference.referenceAlignment?.height, 820);
    const sideBytes = await bytes(reference.referenceViews.side!);
    const recorded = (await readFile(requestsFile, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.equal(recorded.length, 3);
    assert.match(recorded[0].body.prompt, /facing RIGHT/);
    assert.equal(recorded[1].body.input_references[0].image_url.url, recorded[2].body.input_references[0].image_url.url);
    assert.match(recorded[1].body.prompt, /Strict FRONT/);
    assert.match(recorded[2].body.prompt, /Strict BACK/);

    await ok("/api/projects/animations/new", { value: "idle-side" });
    headers["X-Animation-Id"] = "idle-side";
    const idle = await ok("/api/sprites/animate", { text: "idle", model: "x-ai/grok-imagine-video" });
    assert.ok(idle.frames.length >= 4);
    await ok("/api/projects/selection", { selectedIndices: [3, 1] });
    await ok("/api/projects/animations/new", { value: "turn-north" });
    headers["X-Animation-Id"] = "turn-north";
    const startSource = { kind: "animation", animationId: "idle-side", edge: "last" };
    const endSource = { kind: "reference", view: "back" };
    const selected = await ok("/api/projects/draft", { ...draft, startImage: startSource, endImage: endSource });
    assert.deepEqual(await bytes(selected.startImage!.url), await bytes(idle.frames[3]));
    assert.deepEqual(await bytes(selected.endImage!.url), await bytes(reference.referenceViews.back!));
    const savedStartBytes = await bytes(selected.startImage!.url);
    assert.match(selected.startImage!.url, /animations\/turn-north\/inputs\//);
    assert.equal((await post("/api/projects/draft", { ...draft, startImage: { kind: "animation", animationId: "../escape", edge: "last" } })).status, 400);
    assert.equal((await post("/api/projects/draft", { ...draft, startImage: { kind: "reference", view: "other" } })).status, 400);
    assert.equal((await post("/api/projects/draft", { ...draft, startImage: { kind: "animation", animationId: "missing", edge: "last" } })).status, 400);

    response = await post("/api/sprites/animate", { text: "turn north", model: "x-ai/grok-imagine-video" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /only a start image/);
    const beforeRejectedPair = await readFile(requestsFile, "utf8");
    response = await post("/api/sprites/animate", { text: "turn north", model: "minimax/hailuo-3-max" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /H3 Max supports only a start image through OpenRouter/);
    assert.equal(await readFile(requestsFile, "utf8"), beforeRejectedPair, "reject unsupported pairs before calling OpenRouter");
    const afterRejectedPair = await (await fetch(base + "/api/projects/current", { headers })).json() as ProjectView;
    assert.deepEqual(afterRejectedPair.startImage, selected.startImage);
    assert.deepEqual(afterRejectedPair.endImage, selected.endImage);
    const turn = await ok("/api/sprites/animate", { text: "turn north", model: "minimax/hailuo-3" });
    assert.deepEqual(turn.startImage, selected.startImage);
    const calls = (await readFile(requestsFile, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    const video = calls.at(-1).body;
    assert.deepEqual(video.frame_images.map((image: { frame_type: string }) => image.frame_type), ["first_frame", "last_frame"]);
    for (const frame of video.frame_images) {
      const image = await decodeReference(Buffer.from(frame.image_url.url.split(",")[1], "base64"));
      assert.equal(image.w, 1024);
      assert.equal(image.h, 1024);
      assert.deepEqual([...image.pixels.subarray(0, 4)], [0, 177, 64, 255],
        "both saved animation poses and aligned references reach the provider with a green backdrop");
    }
    assert.equal(video.input_references, undefined);
    assert.doesNotMatch(video.prompt, /Create a seamless cycle/);
    assert.match(video.prompt, /exact ending pose/);

    // Another tab changing the active animation cannot redirect a saved endpoint.
    await ok("/api/projects/animations/new", { value: "step-back" });
    const stale = await ok("/api/projects/draft", { ...draft, startImage: startSource, endImage: endSource });
    assert.equal(stale.activeAnimationId, "turn-north");
    delete headers["X-Animation-Id"];
    assert.equal((await post("/api/projects/draft", { ...draft, startImage: startSource })).status, 400);
    assert.equal((await post("/api/sprites/animate", { text: "test" })).status, 400);
    headers["X-Animation-Id"] = "step-back";
    const step = await ok("/api/projects/draft", { ...draft,
      startImage: { kind: "animation", animationId: "turn-north", edge: "last" },
      endImage: { kind: "animation", animationId: "idle-side", edge: "first" } });
    assert.deepEqual(await bytes(step.startImage!.url), await bytes(turn.frames.at(-1)!));
    assert.deepEqual(await bytes(step.endImage!.url), await bytes(idle.frames[1]));
    const savedStepEndBytes = await bytes(step.endImage!.url);
    assert.notDeepEqual(savedStepEndBytes, savedStartBytes, "first and last selected poses differ");
    // A source update leaves its saved pose intact and exposes the new revision as another choice.
    headers["X-Animation-Id"] = "idle-side";
    await ok("/api/projects/selection", { selectedIndices: [0, 2] });
    headers["X-Animation-Id"] = "step-back";
    let latest = await (await fetch(base + "/api/projects/current", { headers })).json() as ProjectView;
    assert.deepEqual(latest.endImage, step.endImage);
    const newestSource = latest.imageSources.find(option => option.source.kind === "animation"
      && option.source.animationId === "idle-side" && option.source.edge === "first")!;
    assert.notEqual(newestSource.source.revision, step.endImage!.source.revision);
    latest = await ok("/api/projects/draft", { ...draft, endImage: newestSource.source });
    assert.deepEqual(latest.endImage!.source, newestSource.source);
    assert.notEqual(latest.endImage!.url, step.endImage!.url);
    assert.deepEqual(await bytes(latest.endImage!.url), await bytes(idle.frames[0]));
    // A stale picker cannot silently capture a different source revision.
    assert.equal((await post("/api/projects/draft", { ...draft, startImage: step.endImage!.source })).status, 400);

    // Failure leaves the complete reference set and existing animation untouched.
    response = await post("/api/sprites/generate", { prompt: "fail-reference" });
    assert.equal(response.status, 400);
    let current = await (await fetch(base + "/api/projects/current", { headers })).json() as ProjectView;
    assert.deepEqual(current.referenceViews, reference.referenceViews);
    assert.deepEqual(await bytes(current.spriteUrl!), sideBytes);
    headers["X-Animation-Id"] = "turn-north";
    assert.equal((await post("/api/sprites/animate", { text: "fail-video", model: "minimax/hailuo-3" })).status, 400);
    current = await (await fetch(base + "/api/projects/current", { headers })).json();
    assert.deepEqual(current.frames, turn.frames);

    headers["X-Animation-Id"] = "idle-side";
    await ok("/api/projects/animations/rename", { value: "idle-east" });
    headers["X-Animation-Id"] = "idle-east";
    await ok("/api/projects/animations/delete", {});
    assert.deepEqual(await bytes(step.endImage!.url), savedStepEndBytes);
    assert.deepEqual(await bytes(selected.startImage!.url), savedStartBytes);
    headers["X-Animation-Id"] = "step-back";
    const renamed = await ok("/api/projects/animations/rename", { value: "step-south" });
    headers["X-Animation-Id"] = "step-south";
    assert.match(renamed.startImage!.url, /animations\/step-south\/inputs\//);
    const duplicated = await ok("/api/projects/animations/duplicate", { value: "step-south-2" });
    assert.match(duplicated.endImage!.url, /animations\/step-south-2\/inputs\//);
    assert.deepEqual(await bytes(renamed.endImage!.url), await bytes(duplicated.endImage!.url));
    headers["X-Animation-Id"] = "step-south-2";
    const renamedCharacter = await ok("/api/projects/sprites/rename", { value: "knight" });
    headers["X-Sprite-Id"] = "knight";
    assert.match(renamedCharacter.startImage!.url, /sprites\/knight\//);
    assert.deepEqual(await bytes(renamedCharacter.referenceViews.side!), sideBytes);
    assert.equal(renamedCharacter.spriteUrl, renamedCharacter.referenceViews.side);
    const reopened = await ok("/api/projects/load", { name: "demo" });
    assert.deepEqual(reopened.startImage, renamedCharacter.startImage);
    assert.deepEqual(reopened.endImage, renamedCharacter.endImage);
    await ok("/api/projects/draft", { ...draft, startImage: null });
    const endOnly = await ok("/api/projects/load", { name: "demo" });
    assert.equal(endOnly.startImage, null);
    assert.deepEqual(endOnly.endImage, reopened.endImage);
    const beforeRejectedEnd = await readFile(requestsFile, "utf8");
    response = await post("/api/sprites/animate", { text: "turn", model: "minimax/hailuo-3-max" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /H3 Max supports only a start image through OpenRouter/);
    assert.equal(await readFile(requestsFile, "utf8"), beforeRejectedEnd, "reject end-only requests before calling OpenRouter");
    current = await (await fetch(base + "/api/projects/current", { headers })).json();
    assert.equal(current.startImage, null, "rejection must not add a first frame");
    assert.deepEqual(current.endImage, endOnly.endImage);
    assert.deepEqual(current.frames, endOnly.frames);
    assert.equal(current.spritesheetUrl, endOnly.spritesheetUrl);
    assert.equal(current.asepriteUrl, endOnly.asepriteUrl);
    // Switching to a compatible model keeps the saved end pose and unset start.
    await ok("/api/sprites/animate", { text: "turn", model: "minimax/hailuo-3" });
    let lastRequest = JSON.parse((await readFile(requestsFile, "utf8")).trim().split("\n").at(-1)!).body;
    assert.deepEqual(lastRequest.frame_images.map((frame: { frame_type: string }) => frame.frame_type), ["last_frame"]);
    await ok("/api/projects/draft", { ...draft, startImage: null, endImage: null });
    current = await (await fetch(base + "/api/projects/current", { headers })).json();
    assert.equal(current.startImage, null);
    assert.equal(current.endImage, null);
    await ok("/api/sprites/animate", { text: "idle", model: "minimax/hailuo-3-max" });
    lastRequest = JSON.parse((await readFile(requestsFile, "utf8")).trim().split("\n").at(-1)!).body;
    assert.equal(lastRequest.frame_images, undefined);
    assert.equal(lastRequest.input_references, undefined);
    assert.match(lastRequest.prompt, /Character: red hero/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit"); child.kill(); await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
