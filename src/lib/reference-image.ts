export const REFERENCE_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
export const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
export type ReferenceImageType = "image/jpeg" | "image/png" | "image/webp";
export interface ReferenceImageAttachment { name: string; url: string }

export function referenceImageType(bytes: Uint8Array): ReferenceImageType | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && [82, 73, 70, 70].every((byte, i) => bytes[i] === byte)
    && [87, 69, 66, 80].every((byte, i) => bytes[i + 8] === byte)) return "image/webp";
  return null;
}

export function isReferenceImageFile(file: Pick<File, "name" | "type">): boolean {
  return /\.(jpe?g|png|webp)$/i.test(file.name)
    && ["", "image/jpeg", "image/png", "image/webp"].includes(file.type);
}

export async function readReferenceImage(file: File): Promise<{ name: string; dataUrl: string } | null> {
  if (!isReferenceImageFile(file)) return null;
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) throw new Error("Reference image must be 20 MB or smaller.");
  const type = referenceImageType(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!type || (file.type && file.type !== type)) return null;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(`data:${type};base64,${String(reader.result).split(",")[1]}`);
    reader.onerror = () => reject(new Error("Could not read reference image."));
    reader.readAsDataURL(file);
  });
  return { name: file.name, dataUrl };
}
