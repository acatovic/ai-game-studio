import type { ReferenceView } from "../../src/lib/character.ts";
import { pngFixture } from "./png.ts";

// Distinct colors and widths expose wrong quadrant mappings and cross-cell leaks.
export const SHEET_COLORS = {
  front: [170, 20, 60, 255], "side-left": [30, 40, 190, 255],
  side: [200, 100, 20, 255], back: [130, 20, 180, 255],
} as const;

export function referenceSheetFixture(size = 256, bad?: "empty" | "clipped") {
  const order: ReferenceView[] = ["front", "side-left", "side", "back"];
  const pixels: number[] = [];
  const cellSize = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cell = Math.floor(y / cellSize) * 2 + Math.floor(x / cellSize);
    const cx = x % cellSize / cellSize, cy = y % cellSize / cellSize;
    const width = cell === 0 || cell === 3 ? .36 : .2;
    const character = cx >= .5 - width / 2 && cx < (bad === "clipped" && cell === 3 ? 1 : .5 + width / 2)
      && cy >= .25 && cy < .875 && !(bad === "empty" && cell === 3);
    // Label and grid stand-ins deliberately differ from the keyed background.
    const decoration = cy < .08 || cx < .01 || cy > .99 || cx > .99;
    pixels.push(...(character ? SHEET_COLORS[order[cell]] : decoration ? [10, 10, 10, 255] : [0, 177, 64, 255]));
  }
  return pngFixture(size, size, pixels);
}
