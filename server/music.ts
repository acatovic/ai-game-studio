import { validatePrompt } from "./validation.js";

export const MUSIC_MODELS = [
  { id: "google/lyria-3-pro-preview", label: "Google Lyria 3 Pro", defaultDuration: 30 },
] as const;
export const DEFAULT_MUSIC_MODEL = MUSIC_MODELS[0].id;
export interface MusicSettings {
  prompt: string;
  model: string;
  duration: number;
  loop: boolean;
}

export function validateMusicSettings(value: unknown, allowEmpty = false): MusicSettings {
  const input = value as Partial<MusicSettings> | null;
  const prompt = validatePrompt(input?.prompt, "Music prompt", allowEmpty);
  if (!MUSIC_MODELS.some(m => m.id === input?.model)) throw new Error("Unsupported music model");
  if (typeof input?.loop !== "boolean") throw new Error("Loop must be true or false");
  const max = 90;
  if (!Number.isInteger(input.duration) || input.duration! < 30 || input.duration! > max) {
    throw new Error(`Music duration must be a whole number between 30 and ${max} seconds`);
  }
  return { prompt, model: input.model!, duration: input.duration!, loop: input.loop };
}

export function musicGenerationPrompt(settings: MusicSettings): string {
  // One extra second is consumed by the circular crossfade; leave another second
  // of margin because Lyria interprets duration through natural language.
  const seconds = settings.duration + (settings.loop ? 2 : 1);
  return `${settings.prompt.trim()}\n\nCreate instrumental background music for a video game. No vocals, lyrics or speech.
Generate at least ${seconds} seconds of continuous music for a ${settings.duration}-second game asset.
${settings.loop
    ? "Use a repeating musical phrase, steady tempo, consistent instrumentation and key. Begin immediately at full texture, without an intro, fade-in, outro, fade-out or trailing silence. The final phrase should lead naturally back to the opening, with matching harmony and rhythm."
    : `Arrange a short cue with a natural resolution around ${settings.duration} seconds.`}`;
}

interface AudioChunk {
  error?: { message?: string };
  choices?: { delta?: { audio?: { data?: string } }; finish_reason?: string }[];
}

/** Parse SSE events, including split UTF-8/network chunks, comments and CRLF. */
export async function readAudioStream(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let total = 0;
  let done = false;
  const parts: string[] = [];
  const consume = (event: string) => {
    const data = event.split("\n").filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).trimStart()).join("\n").trim();
    if (!data) return;
    if (data === "[DONE]") { done = true; return; }
    const chunk = JSON.parse(data) as AudioChunk;
    if (chunk.error) throw new Error(chunk.error.message || "OpenRouter audio generation failed");
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason && choice.finish_reason !== "stop") {
      throw new Error(`OpenRouter audio generation ended: ${choice.finish_reason}`);
    }
    const audio = choice?.delta?.audio?.data;
    if (audio !== undefined) {
      if (typeof audio !== "string" || !/^[A-Za-z0-9+/=]*$/.test(audio)) throw new Error("Invalid audio data from OpenRouter");
      total += audio.length;
      if (total > 80_000_000) throw new Error("Generated audio exceeds the size limit");
      parts.push(audio);
    }
  };
  try {
    while (!done) {
      const next = await reader.read();
      pending += decoder.decode(next.value, { stream: !next.done });
      // Do not normalize a trailing CR until the following network chunk arrives.
      pending = pending.replace(/\r\n/g, "\n");
      let end: number;
      while ((end = pending.indexOf("\n\n")) !== -1) {
        const event = pending.slice(0, end);
        pending = pending.slice(end + 2);
        consume(event);
        if (done) break;
      }
      if (pending.length > 80_000_000) throw new Error("Audio stream event exceeds the size limit");
      if (next.done) {
        if (pending.trim()) consume(pending);
        break;
      }
    }
    if (!done) throw new Error("OpenRouter audio stream was interrupted; please try again");
    if (!total) throw new Error("OpenRouter response did not include audio");
    // Providers may split a single base64 string at any position or send complete,
    // independently padded chunks. Decode each padded segment, retaining carry.
    const encoded = parts.join("");
    const segments = encoded.match(/[A-Za-z0-9+/]+={0,2}/g) ?? [];
    return Buffer.concat(segments.map(part => Buffer.from(part, "base64")));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function generateMusic(settings: MusicSettings): Promise<Buffer> {
  validateMusicSettings(settings);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10 * 60_000),
      body: JSON.stringify({
        model: settings.model,
        modalities: ["text", "audio"],
        audio: { format: "mp3" },
        stream: true,
        messages: [{ role: "user", content: musicGenerationPrompt(settings) }],
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(error.error?.message || `OpenRouter audio request failed (${response.status})`);
    }
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("Expected an audio stream from OpenRouter");
    }
    return await readAudioStream(response.body);
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("Music generation timed out. Please try again.");
    }
    throw error;
  }
}
