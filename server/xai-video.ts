import { xai } from "@ai-sdk/xai";
import { experimental_generateVideo as generateVideo } from "ai";

const CHROMA_DIRECTIVE =
  "Maintain the exact same flat solid pure chroma green background, " +
  "hex #00b140, throughout the entire clip. No background changes, no " +
  "environmental elements, no shadows on the background, no camera movement. " +
  "The subject animates against the uniform green backdrop.";

export async function generateSpriteMotionVideo(
  image: string,
  text: string,
  duration = 2,
): Promise<string> {
  const fullText = `${text.trim()}\n\n${CHROMA_DIRECTIVE}`;

  const result = await generateVideo({
    model: xai.video("grok-imagine-video"),
    prompt: {
      image,
      text: fullText,
    },
    duration,
  });

  const videoUrl = (result as unknown as {
    providerMetadata?: { xai?: { videoUrl?: string } };
  }).providerMetadata?.xai?.videoUrl;

  if (!videoUrl) {
    throw new Error("xAI did not return a video URL.");
  }

  return videoUrl;
}
