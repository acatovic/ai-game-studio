import { test } from "node:test";
import assert from "node:assert/strict";
import { readAudioStream, validateMusicSettings, musicGenerationPrompt, DEFAULT_MUSIC_MODEL, generateMusic } from "../server/music.ts";
import { MUSIC_SAMPLE_RATE, prepareMusicWav } from "../server/music-audio.ts";

const settings = { prompt: "Peaceful forest", model: DEFAULT_MUSIC_MODEL, duration: 30, loop: false };
const event = (data: string) => `data: ${JSON.stringify({ choices: [{ delta: { audio: { data } } }] })}\r\n\r\n`;
function stream(text: string, chunkSize = 7) {
  const encoded = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < encoded.length; offset += chunkSize) controller.enqueue(encoded.slice(offset, offset + chunkSize));
      controller.close();
    },
  });
}

test("music settings enforce duration limits, explicit model and loop mode", () => {
  for (const duration of [30, 45, 90]) assert.equal(validateMusicSettings({ ...settings, duration }).duration, duration);
  assert.equal(validateMusicSettings({ ...settings, duration: 90, loop: true }).loop, true);
  for (const duration of [0, -1, 29, 91, 30.5, NaN, "30", null]) {
    assert.throws(() => validateMusicSettings({ ...settings, duration }), /whole number/);
  }
  assert.throws(() => validateMusicSettings({ ...settings, duration: 91, loop: true }), /90/);
  assert.throws(() => validateMusicSettings({ ...settings, model: "arbitrary" }), /model/);
  assert.throws(() => validateMusicSettings({ ...settings, loop: "true" }), /Loop/);
  assert.throws(() => validateMusicSettings({ ...settings, prompt: "" }), /required/);
  assert.equal(validateMusicSettings({ ...settings, prompt: "" }, true).prompt, "");
  const prompt = musicGenerationPrompt({ ...settings, loop: true });
  assert.match(prompt, /32 seconds/);
  assert.match(prompt, /without an intro/);
  assert.match(prompt, /No vocals/);
});

test("audio SSE parser preserves split base64, padded chunks, CRLF and UTF-8", async () => {
  const data = Buffer.from([0, 255, 4, 55, 97, 128, 43]);
  const base64 = data.toString("base64");
  const text = ': keepalive\r\n\r\ndata: {"choices":[{"delta":{"audio":{"transcript":"♪ forêt"}}}]}\r\n\r\n'
    + event(base64.slice(0, 3)) + event(base64.slice(3))
    + "data: [DONE]\r\n\r\n";
  assert.deepEqual(await readAudioStream(stream(text, 1)), data);
  assert.deepEqual(await readAudioStream(stream(event("YQ==") + event("Yg==") + "data: [DONE]\n\n")), Buffer.from("ab"));
  await assert.rejects(readAudioStream(stream(event(base64))), /interrupted/);
  await assert.rejects(readAudioStream(stream("data: [DONE]\n\n")), /did not include audio/);
  await assert.rejects(readAudioStream(stream('data: {"error":{"message":"provider failed"}}\n\n')), /provider failed/);
  await assert.rejects(readAudioStream(stream('data: {"choices":[{"finish_reason":"error"}]}\n\n')), /ended: error/);
});

test("music generator uses OpenRouter streaming audio without a speech voice or invented duration parameter", async () => {
  const original = globalThis.fetch;
  const oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, DEFAULT_MUSIC_MODEL);
    assert.equal(body.stream, true);
    assert.deepEqual(body.modalities, ["text", "audio"]);
    assert.deepEqual(body.audio, { format: "mp3" });
    assert.equal(body.duration, undefined);
    assert.equal((init!.headers as Record<string, string>).Authorization, "Bearer test-key");
    return new Response(stream(event("YQ==") + "data: [DONE]\n\n"), { headers: { "Content-Type": "text/event-stream" } });
  };
  try { assert.deepEqual(await generateMusic(settings), Buffer.from("a")); }
  finally {
    globalThis.fetch = original;
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldKey;
  }
});

test("WAV preparation produces exact stereo duration and a continuous circular join", () => {
  // Non-integer frequency gives an intentionally mismatched unprocessed boundary.
  const frames = 31 * MUSIC_SAMPLE_RATE;
  const pcm = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    const sample = Math.round(12_000 * Math.sin(2 * Math.PI * 220.37 * i / MUSIC_SAMPLE_RATE));
    pcm.writeInt16LE(sample, i * 4);
    pcm.writeInt16LE(-sample, i * 4 + 2);
  }
  const wav = prepareMusicWav(pcm, 30, true);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt32LE(24), 48_000);
  assert.equal(wav.readUInt32LE(40), 30 * 48_000 * 4);
  assert.equal(wav.length, 44 + 30 * 48_000 * 4);
  for (const channel of [0, 1]) {
    const start = wav.readInt16LE(44 + channel * 2);
    const end = wav.readInt16LE(wav.length - 4 + channel * 2);
    assert.equal(start, pcm.readInt16LE(48_000 * 4 + channel * 2));
    assert.equal(end, pcm.readInt16LE((48_000 - 1) * 4 + channel * 2));
    assert.ok(Math.abs(end - start) < 400, "join retains the source waveform's natural adjacent-sample change");
  }
  const clip = prepareMusicWav(pcm, 30, false);
  assert.equal(clip.readInt16LE(44), 0);
  assert.equal(clip.readInt16LE(clip.length - 4), 0);
  assert.throws(() => prepareMusicWav(pcm.subarray(0, 30 * 48_000 * 4), 30, true), /too short/);
});
