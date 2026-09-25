export const CHARACTER_STYLES = [
  {
    id: "pixel-8bit",
    label: "8-bit Pixel",
    rendering: "pixel",
    description: "Big, crisp pixels and a tiny arcade palette.",
    imagePrompt: "Extremely low-resolution 8-bit game pixel art. Draw the character as deliberate, large, uniform square pixel clusters, as if created on a tiny sprite grid and enlarged with nearest-neighbor scaling. Use a tightly limited palette of about 16 colors, clear one-pixel-scale contours, simple readable shapes, and hard color steps. No antialiasing, smooth gradients, painterly strokes, or 3D rendering.",
    motionPrompt: "Keep the same coarse pixel grid, limited palette, crisp square pixels, and hard color steps in every frame. Do not add antialiasing or smooth rendering.",
  },
  {
    id: "cinematic-pixel",
    label: "Cinematic Pixel",
    rendering: "pixel",
    description: "After Light-style atmospheric 2.5D pixel art.",
    imagePrompt: "Cinematic, high-detail pixel art for a moody 2.5D game. Use intentional pixel clusters, a strong readable silhouette, nuanced but discrete color ramps, rich shadow shapes, and restrained dramatic highlights. Give the character a grounded, atmospheric look without blurring the pixels. Keep environmental lighting effects, bloom, and depth of field out of the isolated sprite.",
    motionPrompt: "Preserve the detailed pixel clusters, discrete color ramps, dramatic shadow shapes, and crisp pixel edges across the animation. Do not blur or smooth the sprite.",
  },
  {
    id: "cel-shaded",
    label: "Cel-shaded 2D",
    rendering: "smooth",
    description: "Expressive animated-film shapes and clean shading.",
    imagePrompt: "High-quality hand-drawn animated-film character art. Use appealing expressive proportions, confident clean contour lines, elegant simplified shapes, a harmonious saturated palette, and two or three distinct hard-edged cel-shading tones. Keep the rendering polished and consistent, with no visible pixel grid, painterly texture, or photorealistic lighting.",
    motionPrompt: "Preserve the clean hand-drawn contours, expressive shapes, harmonious colors, and distinct hard-edged cel-shading tones in every frame. Do not turn the character into pixel art or photorealistic 3D.",
  },
  {
    id: "storybook-3d",
    label: "Storybook 3D",
    rendering: "smooth",
    description: "Rounded, polished 3D animated-film rendering.",
    imagePrompt: "High-quality stylized 3D animated-film character. Use appealing rounded sculpted forms, expressive features, polished soft materials, subtle surface detail, and gentle dimensional form shading. Render as a clean isolated game character with coherent proportions and soft studio-style illumination. No visible pixel grid, hard cel-shading bands, or photorealism.",
    motionPrompt: "Preserve the rounded sculpted forms, soft materials, expressive features, and smooth dimensional 3D shading in every frame. Do not turn the character into pixel art or flat cel-shaded art.",
  },
] as const;

export type CharacterStyleId = (typeof CHARACTER_STYLES)[number]["id"];

export function isCharacterStyleId(value: unknown): value is CharacterStyleId {
  return typeof value === "string" && CHARACTER_STYLES.some(style => style.id === value);
}

export function validateCharacterStyleId(value: unknown): CharacterStyleId | null {
  if (value === null) return null;
  if (isCharacterStyleId(value)) return value;
  throw new Error("Unsupported character art style");
}

export function characterStyle(id: CharacterStyleId | null) {
  return CHARACTER_STYLES.find(style => style.id === id) ?? null;
}

export function usesSmoothRendering(id: CharacterStyleId | null): boolean {
  return characterStyle(id)?.rendering === "smooth";
}

export function characterImagePrompt(description: string, id: CharacterStyleId | null): string {
  const style = characterStyle(id);
  return style ? `${description.trim()}\n\nArt style:\n${style.imagePrompt}` : description.trim();
}
