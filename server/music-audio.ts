import { spawn } from "node:child_process";
import { ensureInsideRoot } from "./files.js";

export const MUSIC_SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const FRAME_BYTES = CHANNELS * 2;

export function decodeMusic(file: string, seconds: number): Promise<Buffer> {
  ensureInsideRoot(file);
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin",
      "-i", file, "-t", String(seconds), "-vn", "-ar", String(MUSIC_SAMPLE_RATE),
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
      if (code !== 0) reject(new Error(`Could not decode generated music${error ? "; the audio may be invalid" : ""}`));
      else resolve(Buffer.concat(chunks));
    });
  });
}

/** PCM WAV avoids compressed-audio encoder delay at the loop boundary. */
export function prepareMusicWav(source: Buffer, seconds: number, loop: boolean): Buffer {
  const frames = Math.round(seconds * MUSIC_SAMPLE_RATE);
  const overlap = loop ? MUSIC_SAMPLE_RATE : 0;
  if (source.length < (frames + overlap) * FRAME_BYTES) {
    throw new Error(`Generated music is too short for ${seconds} seconds${loop ? " plus the loop crossfade" : ""}. Try generating again.`);
  }
  const pcm = Buffer.from(source.subarray(overlap * FRAME_BYTES, (overlap + frames) * FRAME_BYTES));
  if (loop) {
    // Middle first, followed by tail blended into head. On wrap, the next sample
    // is the original sample immediately following the head: no artificial jump.
    for (let frame = 0; frame < overlap; frame++) {
      const weight = frame / (overlap - 1);
      for (let channel = 0; channel < CHANNELS; channel++) {
        const offset = ((frames - overlap + frame) * CHANNELS + channel) * 2;
        const head = source.readInt16LE((frame * CHANNELS + channel) * 2);
        pcm.writeInt16LE(Math.round(pcm.readInt16LE(offset) * (1 - weight) + head * weight), offset);
      }
    }
  } else {
    const fade = Math.round(0.03 * MUSIC_SAMPLE_RATE);
    for (let frame = 0; frame < fade; frame++) {
      const weight = frame / (fade - 1);
      for (let channel = 0; channel < CHANNELS; channel++) {
        for (const index of [frame, frames - frame - 1]) {
          const offset = (index * CHANNELS + channel) * 2;
          pcm.writeInt16LE(Math.round(pcm.readInt16LE(offset) * weight), offset);
        }
      }
    }
  }
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
