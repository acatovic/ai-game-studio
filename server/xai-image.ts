import { xai } from "@ai-sdk/xai";
import { experimental_generateImage as generateImage } from "ai";

const CHROMA_DIRECTIVE =
  "Place the subject on a perfectly flat solid pure chroma green background, " +
  "hex #00b140 (RGB 0, 177, 64). The background must be one uniform color " +
  "with no gradients, no shadows, no lighting variation, and no texture. " +
  "The subject itself must contain no green elements that could conflict " +
  "with chroma keying. Centered, full subject visible.";

export async function generateSpriteImage(prompt: string): Promise<string> {
  const fullPrompt = `${prompt.trim()}\n\n${CHROMA_DIRECTIVE}`;

  const { image } = await generateImage({
    model: xai.image("grok-imagine-image-quality"),
    prompt: fullPrompt,
    size: "1024x1024",
  });

  return image.base64;
}
