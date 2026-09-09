// https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
export interface AsepriteFrame {
  width: number;
  height: number;
  rgba: Uint8Array | Uint8ClampedArray;
}

function word(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${label} must be between 1 and 65535`);
  }
}

function block(size: number, type?: number) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  if (type !== undefined) {
    view.setUint32(0, size, true);
    view.setUint16(4, type, true);
  }
  return { bytes, view };
}

/** One visible, editable layer, with zlib-compressed RGBA cels. */
export async function encodeAseprite(
  frames: AsyncIterable<AsepriteFrame> | Iterable<AsepriteFrame>,
  layerName = "Sprite",
  durationMs = Math.round(1000 / 12),
): Promise<Blob> {
  word(durationMs, "Frame duration");
  const name = new TextEncoder().encode(layerName);
  word(name.length, "Layer name length");
  const layer = block(24 + name.length, 0x2004);
  layer.view.setUint16(6, 3, true); // visible + editable normal layer
  layer.bytes[18] = 255;
  layer.view.setUint16(22, name.length, true);
  layer.bytes.set(name, 24);

  const header = block(128);
  const parts: BlobPart[] = [header.bytes];
  let count = 0;
  let width = 0;
  let height = 0;
  let size = 128;
  for await (const frame of frames) {
    word(++count, "Frame count");
    word(frame.width, "Frame width");
    word(frame.height, "Frame height");
    if (count === 1) { width = frame.width; height = frame.height; }
    if (frame.width !== width || frame.height !== height) {
      throw new Error("Animation frames must have matching dimensions");
    }
    if (frame.rgba.length !== width * height * 4) throw new Error("Invalid RGBA pixel data");
    const compressed = await new Response(
      new Blob([new Uint8Array(frame.rgba)]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer();
    const cel = block(26, 0x2005);
    cel.view.setUint32(0, 26 + compressed.byteLength, true);
    cel.bytes[12] = 255;
    cel.view.setUint16(13, 2, true); // compressed image
    cel.view.setUint16(22, width, true);
    cel.view.setUint16(24, height, true);
    const frameSize = 16 + (count === 1 ? layer.bytes.length : 0) + 26 + compressed.byteLength;
    const frameHeader = block(16, 0xf1fa);
    frameHeader.view.setUint32(0, frameSize, true);
    frameHeader.view.setUint16(6, count === 1 ? 2 : 1, true);
    frameHeader.view.setUint16(8, durationMs, true);
    frameHeader.view.setUint32(12, count === 1 ? 2 : 1, true);
    parts.push(frameHeader.bytes);
    if (count === 1) parts.push(layer.bytes);
    parts.push(cel.bytes, compressed);
    size += frameSize;
    if (size > 0xffffffff) throw new Error("Aseprite export exceeds the 4 GB file limit");
  }
  word(count, "Frame count");
  header.view.setUint32(0, size, true);
  header.view.setUint16(4, 0xa5e0, true);
  header.view.setUint16(6, count, true);
  header.view.setUint16(8, width, true);
  header.view.setUint16(10, height, true);
  header.view.setUint16(12, 32, true);
  header.view.setUint32(14, 1, true);
  header.view.setUint16(18, durationMs, true);
  header.bytes[34] = header.bytes[35] = 1;
  return new Blob(parts, { type: "application/octet-stream" });
}
