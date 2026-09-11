import { spawn } from "node:child_process";
import { ensureInsideRoot } from "./files.js";

export const MUSIC_SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const FRAME_BYTES = CHANNELS * 2;

export function decodeMusic(file: string): Promise<Buffer> {
  ensureInsideRoot(file);
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin",
      "-i", file, "-vn", "-ar", String(MUSIC_SAMPLE_RATE),
      "-ac", String(CHANNELS), "-f", "s16le", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let error = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Audio processing timed out")); }, 60_000);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 40_000_000) {
        child.kill("SIGKILL");
        reject(new Error("Decoded audio exceeds the size limit"));
      } else chunks.push(chunk);
    });
    child.stderr.on("data", chunk => { error = (error + String(chunk)).slice(-2000); });
    child.on("error", err => {
      clearTimeout(timer);
      reject(new Error((err as NodeJS.ErrnoException).code === "ENOENT" ? "ffmpeg is not installed or not on PATH" : "Could not start audio processing"));
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Could not decode generated sound${error ? "; the audio may be invalid" : ""}`));
      else resolve(Buffer.concat(chunks));
    });
  });
}

/** Preserve the provider's full waveform, including native loops and SFX transients. */
export function prepareMusicWav(source: Buffer): Buffer {
  if (!source.length || source.length % FRAME_BYTES !== 0) throw new Error("Invalid or empty decoded audio");
  const pcm = source;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(MUSIC_SAMPLE_RATE, 24);
  header.writeUInt32LE(MUSIC_SAMPLE_RATE * FRAME_BYTES, 28);
  header.writeUInt16LE(FRAME_BYTES, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
