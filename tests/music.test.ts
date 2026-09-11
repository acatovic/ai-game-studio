import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMusicSettings, DEFAULT_MUSIC_MODEL, generateMusic, redactProviderError } from "../server/music.ts";
import { prepareMusicWav } from "../server/music-audio.ts";

const settings = { prompt: "A wooden door creaking open", model: DEFAULT_MUSIC_MODEL, duration: null, loop: false };

test("sound settings allow Auto and decimal 0.5–30-second lengths in both loop modes", () => {
  for (const loop of [true, false]) {
    for (const duration of [null, 0.5, 1, 2.75, 30]) {
      assert.equal(validateMusicSettings({ ...settings, duration, loop }).duration, duration);
    }
    for (const duration of [undefined, 0, -1, 0.49, 30.01, 90, NaN, Infinity, "auto", "3"]) {
      assert.throws(() => validateMusicSettings({ ...settings, duration, loop }), /Invalid length/);
    }
  }
  assert.throws(() => validateMusicSettings({ ...settings, model: "google/lyria-3-pro-preview" }), /model/);
  assert.throws(() => validateMusicSettings({ ...settings, loop: "true" }), /Loop/);
  assert.throws(() => validateMusicSettings({ ...settings, prompt: "" }), /required/);
  assert.equal(validateMusicSettings({ ...settings, prompt: "" }, true).prompt, "");
});

test("ElevenLabs requests preserve Auto, explicit length, native looping and the user's SFX prompt", async () => {
  const original = globalThis.fetch;
  const oldKey = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test-eleven-key";
  const calls: Record<string, unknown>[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128");
    assert.equal((init!.headers as Record<string, string>)["xi-api-key"], "test-eleven-key");
    assert.equal((init!.headers as Record<string, string>).Authorization, undefined);
    assert.equal(init!.redirect, "error");
    calls.push(JSON.parse(init!.body as string));
    return new Response(Buffer.from([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
  };
  try {
    assert.deepEqual(await generateMusic(settings), Buffer.from([1, 2, 3]));
    await generateMusic({ ...settings, duration: 0.5, loop: true });
    assert.deepEqual(calls, [
      { text: settings.prompt, model_id: DEFAULT_MUSIC_MODEL, duration_seconds: null, loop: false },
      { text: settings.prompt, model_id: DEFAULT_MUSIC_MODEL, duration_seconds: 0.5, loop: true },
    ]);
    globalThis.fetch = async () => Response.json({ detail: { message: "Invalid key test-eleven-key" } }, { status: 401 });
    await assert.rejects(generateMusic(settings), /Invalid key \*\*\*/);
    globalThis.fetch = async () => new Response("", { headers: { "Content-Type": "audio/mpeg" } });
    await assert.rejects(generateMusic(settings), /empty audio/);
    globalThis.fetch = async () => Response.json({ detail: "no sound" });
    await assert.rejects(generateMusic(settings), /did not include audio/);
    process.env.ELEVENLABS_API_KEY = "";
    await assert.rejects(generateMusic(settings), /ELEVENLABS_API_KEY/);
  } finally {
    globalThis.fetch = original;
    if (oldKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = oldKey;
  }
});

test("sound WAV encoding preserves every sample including attack, tail and provider loop join", () => {
  const pcm = Buffer.alloc(48_000 * 4 / 2);
  pcm.writeInt16LE(32000, 0);
  pcm.writeInt16LE(-30000, pcm.length - 2);
  const wav = prepareMusicWav(pcm);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt32LE(24), 48_000);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
  assert.throws(() => prepareMusicWav(Buffer.alloc(0)), /empty/);
  assert.throws(() => prepareMusicWav(Buffer.alloc(3)), /Invalid/);
  assert.equal(redactProviderError("bad sk_secret xai-secret sk-or-secret"), "bad *** *** ***");
});
