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
    return `${model.label} supports only a start image. Clear the end image or choose another model.`;
  }
  if (hasStartImage && hasEndImage && model.maxKeyframeImages < 2) {
    return `${model.label} accepts one keyframe image: choose a start or an end image, not both. ` +
      "Choose MiniMax H3 or Seedance to use both.";
  }
  return null;
}
