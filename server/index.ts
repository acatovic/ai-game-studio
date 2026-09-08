import "dotenv/config";
import { initializeStorage } from "./storage.js";
await initializeStorage();
import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  generateSpriteImage,
  isImageModelId,
} from "./image.js";
import {
  DEFAULT_VIDEO_MODEL,
  VIDEO_MODELS,
  defaultDurationFor,
  generateSpriteMotionVideo,
  isVideoModelId,
} from "./video.js";
import { extractFrames } from "./extract-frames.js";
import { buildPreviewGif } from "./build-gif.js";
import {
  activeSpriteDir,
  PROJECTS_DIR,
  PROJECT_FILES,
  projectContext,
  safeProjectName,
  downloadVideo,
  ensureInsideRoot,
  readPngDims,
  saveBase64Image,
  saveDataUrlPng,
} from "./files.js";
import {
  deleteSavedProject,
  createProject,
  changeSprite,
  listSavedProjects,
  openProject,
  readManifest,

  toView,
  updateSprite,
  wipeFramesAndSheet,
  wipeSpritesheet,
} from "./projects.js";


const PORT = Number(process.env.PORT ?? 8787);
const HAS_KEY = Boolean(process.env.OPENROUTER_API_KEY);

const app = express();
app.use(express.json({ limit: "50mb" }));
let mutating = false;
app.use("/api", (req, res, next) => {
  if (req.method !== "POST") return next();
  if (mutating) { res.status(409).json({ error: "Another operation is in progress. Please try again." }); return; }
  mutating = true;
  res.once("finish", () => { mutating = false; });
  next();
});
app.use("/api", (req, res, next) => {
  const name = req.get("X-Project-Name");
  const spriteId = req.get("X-Sprite-Id");
  if (!name && !spriteId) return next();
  try {
    safeProjectName(name ?? "");
    safeProjectName(spriteId ?? "");
    projectContext.run({ name: name!, spriteId: spriteId! }, next);
  } catch (err) { handleError(err, res); }
});
app.use("/projects", express.static(PROJECTS_DIR, { fallthrough: false }));

function requireKey(_req: Request, res: Response, next: NextFunction) {
  if (!HAS_KEY) {
    res.status(500).json({
      error: "OPENROUTER_API_KEY is not configured. Add it to .env and restart the server.",
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

app.get("/api/models/video", (_req, res) => {
  res.json({ models: VIDEO_MODELS, default: DEFAULT_VIDEO_MODEL });
});

app.get("/api/models/image", (_req, res) => {
  res.json({ models: IMAGE_MODELS, default: DEFAULT_IMAGE_MODEL });
});

app.get("/api/projects/current", async (_req, res) => {
  try {
    res.json(toView(await readManifest()));
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

app.post("/api/projects/save", async (_req, res) => {
  try {
    res.json(await updateSprite({}).then(toView));
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/load", async (req, res) => {
  try {
    const name = asString(req.body?.name, "name", 40);
    res.json(await openProject(name));
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/new", async (req, res) => {
  try { res.json(await createProject(asString(req.body?.name, "name", 40))); }
  catch (err) { handleError(err, res); }
});

app.post("/api/projects/sprites/:action", async (req, res) => {
  try {
    const action = req.params.action;
    if (action !== "new" && action !== "load" && action !== "rename") throw new Error("Unknown sprite action");
    res.json(await changeSprite(action, asString(req.body?.value, "value", 60)));
  } catch (err) { handleError(err, res); }
});

app.post("/api/projects/draft", async (req, res) => {
  try {
    const patch: Record<string, string> = {};
    for (const key of ["spritePrompt", "motionPrompt", "spriteModel", "motionModel"]) {
      const value = req.body?.[key];
      if (typeof value !== "string" || value.length > 2000) throw new Error("Invalid sprite draft");
      patch[key] = value;
    }
    res.json(toView(await updateSprite(patch)));
  } catch (err) { handleError(err, res); }
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
    const m = await updateSprite({ selectedFrameIndices: indices });
    res.json(toView(m));
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/spritesheet", async (req, res) => {
  try {
    await readManifest();
    const dataUrl = asString(req.body?.dataUrl, "dataUrl", 50_000_000);
    const spritesheetAbs = path.join(activeSpriteDir(), PROJECT_FILES.spritesheet);
    await saveDataUrlPng(dataUrl, spritesheetAbs);

    let m = await updateSprite({ spritesheet: PROJECT_FILES.spritesheet });

    // Best-effort GIF build from current selection
    try {
      const gifName = await buildPreviewGif(m.selectedFrameIndices);
      m = await updateSprite({ previewGif: gifName });
    } catch (gifErr) {
      const msg = gifErr instanceof Error ? gifErr.message : String(gifErr);
      console.warn("[api] preview gif build failed:", msg);
      m = await updateSprite({ previewGif: null });
    }

    res.json(toView(m));
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/sprites/generate", requireKey, async (req, res) => {
  try {
    await readManifest();
    const prompt = asString(req.body?.prompt, "prompt");
    const requestedModel = req.body?.model;
    if (requestedModel !== undefined && !isImageModelId(requestedModel)) {
      throw new Error("unsupported image model");
    }
    const model = requestedModel ?? DEFAULT_IMAGE_MODEL;
    const base64 = await generateSpriteImage(prompt, model);

    // Reset downstream artifacts (frames + spritesheet) before writing the new sprite
    await wipeFramesAndSheet();

    const refAbs = path.join(activeSpriteDir(), PROJECT_FILES.ref);
    await saveBase64Image(base64, refAbs);
    const buf = await readFile(refAbs);
    const dims = readPngDims(buf);

    const m = await updateSprite({
      spritePrompt: prompt,
      spriteModel: model,
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
    await readManifest();
    const image = asImageRef(req.body?.image);
    const text = asString(req.body?.text, "text");
    const model = isVideoModelId(req.body?.model) ? req.body.model : DEFAULT_VIDEO_MODEL;
    const duration =
      typeof req.body?.duration === "number" ? req.body.duration : defaultDurationFor(model);

    const imageInput = await resolveImageInput(image);

    await wipeSpritesheet();

    const video = await generateSpriteMotionVideo(imageInput, text, duration, model);
    const videoAbs = path.join(activeSpriteDir(), PROJECT_FILES.source);
    await downloadVideo(video.url, videoAbs, video.headers);

    const framesAbs = path.join(activeSpriteDir(), PROJECT_FILES.framesDir);
    const frameFiles = await extractFrames(videoAbs, framesAbs);
    const frames = frameFiles.map((f) => `${PROJECT_FILES.framesDir}/${f}`);

    const m = await updateSprite({
      motionPrompt: text,
      motionModel: model,
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
    const abs = path.join(PROJECTS_DIR, cleanPath.slice("/projects/".length));
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
  return msg.replace(/sk-or-[A-Za-z0-9_-]+/g, "***");
}

const server = app.listen(PORT, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  console.log(`[server] listening on http://localhost:${port}`);
  if (!HAS_KEY) {
    console.warn("[server] WARNING: OPENROUTER_API_KEY is missing — endpoints will return 500");
  }
});
