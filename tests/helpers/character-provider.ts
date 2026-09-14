import { appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pngFixture } from "./png.ts";

const frames = Buffer.alloc(6 * 128 * 128 * 4);
for (let frame = 0; frame < 6; frame++) for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
  const pixel = x >= 40 + frame * 2 && x < 72 + frame * 2 && y >= 16 && y < 112
    ? [200, 20, 60, 255] : [0, 177, 64, 255];
  frames.set(pixel, ((frame * 128 + y) * 128 + x) * 4);
}
const clip = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "rawvideo",
  "-pixel_format", "rgba", "-video_size", "128x128", "-framerate", "12", "-i", "pipe:0",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"],
  { input: frames });
if (clip.status !== 0) throw new Error("Could not prepare test video");

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === "https://fixture.invalid/source.mp4") return new Response(clip.stdout);
  const body = JSON.parse(String(init?.body ?? "{}"));
  if (process.env.STUDIO_TEST_REQUESTS) await appendFile(process.env.STUDIO_TEST_REQUESTS, JSON.stringify({ url, body }) + "\n");
  if (url === "https://openrouter.ai/api/v1/images") {
    const back = body.prompt.includes("Strict BACK");
    if (back && body.prompt.includes("fail-reference")) {
      return new Response(JSON.stringify({ error: { message: "Fixture image failure" } }), { status: 500 });
    }
    const front = body.prompt.includes("Strict FRONT");
    const left = front ? 10 : back ? 30 : 22;
    const top = front ? 10 : back ? 20 : 4;
    const width = front ? 22 : back ? 26 : 14;
    const height = front ? 45 : back ? 36 : 55;
    const pixels = [];
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      pixels.push(...(x >= left && x < left + width && y >= top && y < top + height
        ? [170, 20, 60, 255] : [0, 177, 64, 255]));
    }
    return Response.json({ data: [{ b64_json: pngFixture(64, 64, pixels).toString("base64"), media_type: "image/png" }] });
  }
  if (url === "https://openrouter.ai/api/v1/videos") {
    if (body.model === "minimax/hailuo-3-max") {
      if (body.frame_images?.length > 1) {
        return Response.json({ error: "This model supports a single keyframe image: send either a first_frame or a last_frame, not both" }, { status: 400 });
      }
      if (body.frame_images?.some((frame: { frame_type: string }) => frame.frame_type === "last_frame")) {
        return Response.json({ error: "invalid params, last_frame requires first_frame for model MiniMax-H3-Max (2013)" }, { status: 400 });
      }
    }
    if (body.prompt.includes("fail-video")) return Response.json({ error: "Fixture video failure" }, { status: 500 });
    return Response.json({ id: "fixture", status: "completed", unsigned_urls: ["https://fixture.invalid/source.mp4"] });
  }
  throw new Error(`Unexpected provider request: ${url}`);
};
