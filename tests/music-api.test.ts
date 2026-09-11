import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, readdir, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";

test("music lifecycle is project-scoped, preserves failed generations, and survives renames and reopen", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-music-"));
  const fixture = path.join(root, "fixture.mp3");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    "sine=frequency=220:duration=46", "-q:a", "9", fixture]);
  const child = spawn(process.execPath, ["--import", "tsx", "--import", "./tests/helpers/music-provider.ts", "server/index.ts"], {
    env: { ...process.env, PORT: "0", AI_GAME_STUDIO_HOME: root, OPENROUTER_API_KEY: "test-key", MUSIC_TEST_AUDIO: fixture },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Server startup timed out")), 10_000);
      child.stdout.on("data", chunk => {
        const match = String(chunk).match(/http:\/\/localhost:(\d+)/);
        if (match) { clearTimeout(timer); resolve(`http://localhost:${match[1]}`); }
      });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${stderr}`)); });
    });
    let headers: Record<string, string> = { "Content-Type": "application/json" };
    const post = (route: string, body: unknown) => fetch(base + route, { method: "POST", headers, body: JSON.stringify(body) });
    const get = (route: string) => fetch(base + route, { headers });
    const settings = { prompt: "Forest village", model: "google/lyria-3-pro-preview", duration: 30, loop: true };
    assert.equal((await post("/api/music/new", { value: "forest" })).status, 400);
    assert.equal((await post("/api/projects/new", { name: "game" })).status, 200);
    headers["X-Project-Name"] = "game";
    assert.deepEqual((await (await get("/api/music")).json()).tracks, []);
    assert.equal((await (await get("/api/models/music")).json()).default, settings.model);
    assert.equal((await post("/api/music/new", { value: "forest" })).status, 200);
    headers["X-Music-Id"] = "forest";
    assert.equal((await post("/api/music/draft", settings)).status, 200);
    const generated = await post("/api/music/generate", settings);
    assert.equal(generated.status, 200, await generated.clone().text());
    const saved = await generated.json();
    const audio = Buffer.from(await (await get(saved.track.audioUrl)).arrayBuffer());
    assert.equal(audio.readUInt32LE(40), 30 * 48_000 * 4);
    assert.equal(saved.track.output.crossfadeSeconds, 1);
    assert.ok(saved.track.audioUrl.endsWith("/forest.wav"));
    const manifestPath = path.join(root, "game/music/forest/music.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.output.audio.startsWith("revisions/"), true);
    await readFile(path.join(root, "game/music/forest", manifest.output.source));
    // Failed provider responses and failed audio processing leave both output and files intact.
    const failed = await post("/api/music/generate", { ...settings, prompt: "FAIL" });
    assert.equal(failed.status, 400);
    assert.equal((await failed.json()).error, "Provider rejected *** ***");
    assert.equal((await post("/api/music/generate", { ...settings, prompt: "SHORT" })).status, 400);
    assert.equal((await (await get("/api/music")).json()).track.audioUrl, saved.track.audioUrl);
    assert.equal((await readdir(path.join(root, "game/music/forest/revisions"))).length, 1);
    assert.equal((await post("/api/music/generate", { ...settings, duration: 91 })).status, 400);
    assert.equal((await post("/api/music/new", { value: "../escape" })).status, 400);
    assert.equal((await post("/api/music/new", { value: "FOREST" })).status, 400);
    // A second track becomes active; original tab continues to target forest explicitly.
    assert.equal((await post("/api/music/new", { value: "battle" })).status, 200);
    assert.equal((await post("/api/music/draft", { ...settings, prompt: "Forest revised" })).status, 200);
    assert.equal((await (await get("/api/music")).json()).track.prompt, "Forest revised");
    delete headers["X-Music-Id"];
    assert.equal((await post("/api/music/draft", settings)).status, 400);
    assert.equal((await (await get("/api/music")).json()).track.prompt, "");
    headers["X-Music-Id"] = "forest";
    // Existing unrelated directories cannot be overwritten on rename.
    await mkdir(path.join(root, "game/music/reserved"));
    assert.equal((await post("/api/music/rename", { value: "reserved" })).status, 400);
    const renamed = await post("/api/music/rename", { value: "village" });
    assert.equal(renamed.status, 200, await renamed.clone().text());
    const view = await renamed.json();
    assert.equal(view.track.name, "village");
    assert.ok(view.track.audioUrl.endsWith("/village.wav"));
    assert.deepEqual(Buffer.from(await (await get(view.track.audioUrl)).arrayBuffer()), audio);
    assert.equal((await post("/api/music/draft", settings)).status, 400, "stale track header must fail");
    headers["X-Music-Id"] = "village";
    assert.equal((await post("/api/projects/sprites/new", { value: "hero" })).status, 200);
    assert.equal((await post("/api/projects/load", { name: "game" })).status, 200);
    const reopened = await (await get("/api/music")).json();
    assert.equal(reopened.track.prompt, "Forest revised");
    assert.equal(reopened.track.audioUrl, view.track.audioUrl);
    assert.equal(reopened.tracks.length, 2);
    // Changing the project header cannot write another project's same-name track.
    await post("/api/projects/new", { name: "other" });
    headers["X-Project-Name"] = "other";
    assert.equal((await post("/api/music/draft", settings)).status, 400);
    delete headers["X-Music-Id"];
    assert.deepEqual((await (await get("/api/music")).json()).tracks, []);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit"); child.kill(); await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
