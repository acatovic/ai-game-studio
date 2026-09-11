// Loaded only by the music integration test's child process.
import { readFile } from "node:fs/promises";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) !== "https://openrouter.ai/api/v1/chat/completions") return originalFetch(url, init);
  const body = JSON.parse(String(init?.body));
  if (body.model !== "google/lyria-3-pro-preview" || !body.stream || body.audio.format !== "mp3") {
    throw new Error("Unexpected music generation request");
  }
  if (body.messages[0].content.startsWith("FAIL")) {
    return Response.json({ error: { message: "Provider rejected sk-or-secret xai-secret" } }, { status: 400 });
  }
  const data = body.messages[0].content.startsWith("SHORT")
    ? Buffer.from("invalid audio") : await readFile(process.env.MUSIC_TEST_AUDIO!);
  const events = `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: data.toString("base64") } } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(events, { headers: { "Content-Type": "text/event-stream" } });
};
