export const FRAME_SIZES = [64, 128, 256] as const;
export type FrameSize = (typeof FRAME_SIZES)[number];
export const DEFAULT_FRAME_SIZE: FrameSize = 128;

export function isFrameSize(value: unknown): value is FrameSize {
  return typeof value === "number" && FRAME_SIZES.some(size => size === value);
}

export function validateFrameSize(value: unknown): FrameSize {
  if (!isFrameSize(value)) throw new Error("Frame size must be 64, 128, or 256 pixels");
  return value;
}
