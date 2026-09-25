import { DEFAULT_FRAME_SIZE, validateFrameSize, type FrameSize } from "./frame-size";

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image: ${src}`));
    img.src = src;
  });
}

export interface SpritesheetOptions {
  frameSrcs: string[];
  cellSize?: FrameSize;
  smooth?: boolean;
}

export interface SpritesheetResult {
  dataUrl: string;
  cols: number;
  rows: number;
}

export async function composeSpritesheet({
  frameSrcs,
  cellSize = DEFAULT_FRAME_SIZE,
  smooth = false,
}: SpritesheetOptions): Promise<SpritesheetResult> {
  validateFrameSize(cellSize);
  if (frameSrcs.length === 0) {
    throw new Error("no frames selected");
  }
  const images = await Promise.all(frameSrcs.map(loadImage));
  const cols = images.length;
  const rows = 1;
  const canvas = document.createElement("canvas");
  canvas.width = cols * cellSize;
  canvas.height = rows * cellSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.imageSmoothingEnabled = smooth;
  if (smooth) ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < images.length; i++) {
    drawContained(ctx, images[i], i * cellSize, 0, cellSize, cellSize);
  }

  const dataUrl = canvas.toDataURL("image/png");
  if (!dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("This spritesheet is too wide for your browser. Select fewer frames or a smaller frame size.");
  }
  return { dataUrl, cols, rows };
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const ratio = Math.min(w / img.width, h / img.height);
  const dw = img.width * ratio;
  const dh = img.height * ratio;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
