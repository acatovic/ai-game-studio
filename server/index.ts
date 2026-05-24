import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { generateSpriteImage } from "./xai-image.js";
import { generateSpriteMotionVideo } from "./xai-video.js";
import { extractFrames } from "./extract-frames.js";
import { buildPreviewGif } from "./build-gif.js";
import {
  LATEST_DIR,
  PROJECTS_DIR,
  PROJECT_FILES,
  ROOT_DIR,
  downloadVideo,
  ensureInsideRoot,
  readPngDims,
  saveBase64Image,
  saveDataUrlPng,
} from "./files.js";
import {
  deleteSavedProject,
  emptyManifest,
  listSavedProjects,
  loadProjectIntoLatest,
  readManifest,
  saveLatestAs,
  toView,
  updateLatest,
  wipeLatestFramesAndSheet,
  wipeLatestSpritesheet,
} from "./projects.js";
import { rm } from "node:fs/promises";

const PORT = Number(process.env.PORT ?? 8787);
const HAS_KEY = Boolean(process.env.XAI_API_KEY);

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use("/projects", express.static(PROJECTS_DIR, { fallthrough: false }));

function requireKey(_req: Request, res: Response, next: NextFunction) {
  if (!HAS_KEY) {
    res.status(500).json({
      error: "XAI_API_KEY is not configured. Add it to .env and restart the server.",
    });
    return;
  }
  next();
}

function asString(v: unknown, name: string, max = 2_000): string {
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  if (v.length > max) throw new Error(`${name} is too long`);
  return v.trim();
}

function asImageRef(v: unknown): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new Error("image is required");
  }
  if (v.length > 50_000_000) throw new Error("image is too large");
  return v;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasApiKey: HAS_KEY });
});

app.get("/api/projects/current", async (_req, res) => {
  try {
    res.json(toView(await readManifest("latest")));
  } catch (err) {
    handleError(err, res);
  }
});

app.get("/api/projects", async (_req, res) => {
  try {
    res.json(await listSavedProjects());
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/save", async (req, res) => {
  try {
    const name = asString(req.body?.name, "name", 40);
    res.json(await saveLatestAs(name));
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/load", async (req, res) => {
  try {
    const name = asString(req.body?.name, "name", 40);
    res.json(await loadProjectIntoLatest(name));
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/new", async (_req, res) => {
  try {
    if (existsSync(LATEST_DIR)) {
      await rm(LATEST_DIR, { recursive: true, force: true });
    }
    res.json(toView(emptyManifest("latest")));
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/delete", async (req, res) => {
  try {
    const name = asString(req.body?.name, "name", 40);
    await deleteSavedProject(name);
    res.json({ ok: true });
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/selection", async (req, res) => {
  try {
    const indices = req.body?.selectedIndices;
    if (!Array.isArray(indices) || indices.some((i) => typeof i !== "number")) {
      throw new Error("selectedIndices must be an array of numbers");
    }
    const m = await updateLatest({ selectedFrameIndices: indices });
    res.json(toView(m));
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/spritesheet", async (req, res) => {
  try {
    const dataUrl = asString(req.body?.dataUrl, "dataUrl", 50_000_000);
    const spritesheetAbs = path.join(LATEST_DIR, PROJECT_FILES.spritesheet);
    await saveDataUrlPng(dataUrl, spritesheetAbs);

    let m = await updateLatest({ spritesheet: PROJECT_FILES.spritesheet });

    // Best-effort GIF build from current selection
    try {
      const gifName = await buildPreviewGif(m.selectedFrameIndices);
      m = await updateLatest({ previewGif: gifName });
    } catch (gifErr) {
      const msg = gifErr instanceof Error ? gifErr.message : String(gifErr);
      console.warn("[api] preview gif build failed:", msg);
      m = await updateLatest({ previewGif: null });
    }

    res.json(toView(m));
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/sprites/generate", requireKey, async (req, res) => {
  try {
    const prompt = asString(req.body?.prompt, "prompt");
    const base64 = await generateSpriteImage(prompt);

    // Reset downstream artifacts (frames + spritesheet) before writing the new sprite
    await wipeLatestFramesAndSheet();

    const refAbs = path.join(LATEST_DIR, PROJECT_FILES.ref);
    await saveBase64Image(base64, refAbs);
    const buf = await readFile(refAbs);
    const dims = readPngDims(buf);

    const m = await updateLatest({
      spritePrompt: prompt,
      sprite: PROJECT_FILES.ref,
      spriteDimensions: dims,
      frames: [],
      selectedFrameIndices: [],
      spritesheet: null,
      previewGif: null,
    });

    res.json({
      view: toView(m),
      dataUrl: `data:image/png;base64,${base64}`,
    });
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/sprites/animate", requireKey, async (req, res) => {
  try {
    const image = asImageRef(req.body?.image);
    const text = asString(req.body?.text, "text");
    const duration =
      typeof req.body?.duration === "number" ? req.body.duration : 2;

    const imageInput = await resolveImageInput(image);

    await wipeLatestSpritesheet();

    const videoUrl = await generateSpriteMotionVideo(imageInput, text, duration);
    const videoAbs = path.join(LATEST_DIR, PROJECT_FILES.source);
    await downloadVideo(videoUrl, videoAbs);

    const framesAbs = path.join(LATEST_DIR, PROJECT_FILES.framesDir);
    const frameFiles = await extractFrames(videoAbs, framesAbs);
    const frames = frameFiles.map((f) => `${PROJECT_FILES.framesDir}/${f}`);

    const m = await updateLatest({
      motionPrompt: text,
      frames,
      selectedFrameIndices: frames.map((_, i) => i),
      spritesheet: null,
      previewGif: null,
    });

    res.json(toView(m));
  } catch (err) {
    handleError(err, res);
  }
});

async function resolveImageInput(image: string): Promise<string> {
  if (image.startsWith("data:")) return image;
  if (image.startsWith("/projects/")) {
    const cleanPath = image.split("?")[0];
    const abs = path.join(ROOT_DIR, cleanPath.replace(/^\//, ""));
    ensureInsideRoot(abs);
    if (!existsSync(abs)) throw new Error("sprite image not found on disk");
    const buf = await readFile(abs);
    return `data:image/png;base64,${buf.toString("base64")}`;
  }
  if (/^https?:\/\//.test(image)) return image;
  throw new Error("unsupported image reference");
}

function handleError(err: unknown, res: Response) {
  const message = err instanceof Error ? err.message : "Unknown error";
  const safe = redact(message);
  console.error("[api error]", safe);
  res.status(400).json({ error: safe });
}

function redact(msg: string): string {
  return msg.replace(/xai-[A-Za-z0-9_-]+/g, "***");
}

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  if (!HAS_KEY) {
    console.warn("[server] WARNING: XAI_API_KEY is missing — endpoints will return 500");
  }
});
