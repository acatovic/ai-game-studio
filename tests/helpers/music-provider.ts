// Loaded only by the sound integration test's child process; no external calls.
import { readFile } from "node:fs/promises";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) !== "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128") return originalFetch(url, init);
  const body = JSON.parse(String(init?.body));
  if (body.model_id !== "eleven_text_to_sound_v2" || typeof body.loop !== "boolean"
    || !(body.duration_seconds === null || (body.duration_seconds >= 0.5 && body.duration_seconds <= 30))) {
    throw new Error("Unexpected sound generation request");
  }
  if (body.text.startsWith("AUTO") && body.duration_seconds !== null) throw new Error("Auto must reach ElevenLabs as null");
  if (body.text.startsWith("FAIL")) {
    return Response.json({ detail: { message: "Provider rejected sk-or-secret xai-secret" } }, { status: 400 });
  }
  const data = body.text.startsWith("SHORT")
    ? Buffer.from("invalid audio") : await readFile(process.env.MUSIC_TEST_AUDIO!);
  return new Response(data, { headers: { "Content-Type": "audio/mpeg" } });
};
