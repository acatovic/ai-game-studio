export interface VideoFrameCapabilities {
  label: string;
  supportsEndImage: boolean;
  maxKeyframeImages: number;
}

export function videoFrameError(
  model: VideoFrameCapabilities,
  hasStartImage: boolean,
  hasEndImage: boolean,
): string | null {
  if (hasEndImage && !model.supportsEndImage) {
    return `${model.label} supports only a start image through OpenRouter. ` +
      "Clear the end image or choose MiniMax H3 or Seedance.";
  }
  if (hasStartImage && hasEndImage && model.maxKeyframeImages < 2) {
    return `${model.label} accepts one keyframe image: choose a start or an end image, not both. ` +
      "Choose MiniMax H3 or Seedance to use both.";
  }
  return null;
}
