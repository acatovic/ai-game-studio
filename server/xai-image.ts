// Image generation via OpenRouter chat completions API.
// Model: x-ai/grok-imagine-image-quality
// Endpoint: POST https://openrouter.ai/api/v1/chat/completions with modalities: ["image", "text"]

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const MODEL = "x-ai/grok-imagine-image-quality";

const CHROMA_DIRECTIVE =
  "Place the subject on a perfectly flat solid pure chroma green background, " +
  "hex #00b140 (RGB 0, 177, 64). The background must be one uniform color " +
  "with no gradients, no shadows, no lighting variation, and no texture. " +
  "The subject itself must contain no green elements that could conflict " +
  "with chroma keying. Centered, full subject visible.";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
      images?: Array<{
        type?: string;
        image_url?: { url?: string };
      }>;
    };
  }>;
  error?: { message?: string; code?: string | number } | string;
}

export async function generateSpriteImage(prompt: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const fullPrompt = `${prompt.trim()}\n\n${CHROMA_DIRECTIVE}`;

  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      modalities: ["image"],
      messages: [{ role: "user", content: fullPrompt }],
    }),
  });

  const json = (await res.json().catch(() => ({}))) as ChatCompletionResponse;

  if (!res.ok) {
    const msg =
      typeof json.error === "string"
        ? json.error
        : json.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`OpenRouter image generation failed: ${msg}`);
  }

  const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) {
    throw new Error("OpenRouter response did not include an image");
  }

  // OpenRouter typically returns a base64 data URL; some providers may return an HTTPS URL.
  if (url.startsWith("data:")) {
    const match = url.match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/);
    if (!match) throw new Error("malformed image data URL from OpenRouter");
    return match[1];
  }
  if (/^https?:\/\//.test(url)) {
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`failed to fetch generated image (${imgRes.status})`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    return buf.toString("base64");
  }
  throw new Error("unsupported image URL format in OpenRouter response");
}
