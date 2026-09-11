import { validatePrompt } from "./validation.js";

// Keep the existing music storage/API names compatible with saved projects.
export const MUSIC_MODELS = [
  { id: "eleven_text_to_sound_v2", label: "ElevenLabs Sound Effects v2", defaultDuration: null },
] as const;
export const DEFAULT_MUSIC_MODEL = MUSIC_MODELS[0].id;
export interface MusicSettings {
  prompt: string;
  model: string;
  /** null means the provider chooses a duration from the prompt. */
  duration: number | null;
  loop: boolean;
}

export function validateMusicSettings(value: unknown, allowEmpty = false): MusicSettings {
  const input = value as Partial<MusicSettings> | null;
  const prompt = validatePrompt(input?.prompt, "Sound prompt", allowEmpty);
  if (!MUSIC_MODELS.some(m => m.id === input?.model)) throw new Error("Unsupported sound model");
  if (typeof input?.loop !== "boolean") throw new Error("Loop must be true or false");
  if (input.duration !== null && (typeof input.duration !== "number" || !Number.isFinite(input.duration)
    || input.duration < 0.5 || input.duration > 30)) {
    throw new Error("Invalid length. Choose Auto or a number from 0.5 to 30 seconds.");
  }
  return { prompt, model: input.model!, duration: input.duration!, loop: input.loop };
}

export function redactProviderError(message: string): string {
  for (const key of [process.env.ELEVENLABS_API_KEY, process.env.OPENROUTER_API_KEY]) {
    if (key) message = message.split(key).join("***");
  }
  return message.replace(/(?:sk-or-|xai-|sk_)[A-Za-z0-9_-]+/g, "***");
}

export async function generateMusic(settings: MusicSettings): Promise<Buffer> {
  validateMusicSettings(settings);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured. Add it to .env and restart the server.");
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      redirect: "error",
      signal: AbortSignal.timeout(5 * 60_000),
      body: JSON.stringify({
        text: settings.prompt.trim(),
        model_id: settings.model,
        duration_seconds: settings.duration,
        loop: settings.loop,
      }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { detail?: string | { message?: string }; error?: { message?: string } };
      const detail = typeof error.detail === "string" ? error.detail : error.detail?.message;
      throw new Error(detail || error.error?.message || `ElevenLabs sound generation failed (${response.status})`);
    }
    if (!response.body || !response.headers.get("content-type")?.match(/audio\/|application\/octet-stream/)) {
      throw new Error("ElevenLabs response did not include audio");
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 20_000_000) throw new Error("Generated audio exceeds the size limit");
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!size) throw new Error("ElevenLabs returned empty audio");
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("Sound generation timed out. Please try again.");
    }
    throw new Error(redactProviderError(error instanceof Error ? error.message : "Sound generation failed"));
  }
}
