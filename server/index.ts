import "dotenv/config";
import { validatePrompt } from "./validation.js";
import { createProjectArchive, receiveProjectArchive, importProjectArchive, removeArchive, ProjectImportConflict } from "./project-archive.js";
import { initializeStorage } from "./storage.js";
await initializeStorage();
import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { MUSIC_MODELS, DEFAULT_MUSIC_MODEL, validateMusicSettings, generateMusic, redactProviderError } from "./music.js";
import { changeMusic, deleteMusic, musicView, readMusic, saveMusicDraft, commitMusicOutput, musicFile, newMusicRevision } from "./music-projects.js";
import { decodeMusic, prepareMusicWav, MUSIC_SAMPLE_RATE } from "./music-audio.js";
import { stageAnimationAssets } from "./animation-assets.js";
import { validateFrameSize } from "../src/lib/frame-size.js";
import { characterImagePrompt, characterStyle, validateCharacterStyleId } from "../src/lib/character-styles.js";
import { generateCharacterReferences } from "./character-references.js";
import { stageReferenceImage, referenceImageDataUrl } from "./reference-image.js";
import { existsSync } from "node:fs";
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
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
  safeAssetId,
  downloadVideo,
  ensureInsideRoot,
  spriteFile,
  readPngDims,
} from "./files.js";
import {
  deleteSavedProject,
  deleteSprite,
  deleteAnimation,
  createProject,
  changeSprite,
  listSavedProjects,
  openProject,
  readManifest,

  toView,
  updateSprite,
  changeAnimation,
  animationPath,
  assetName,
  stageAnimationImage,
  commitCharacterReferences,
  commitReferenceImage,
  type ProjectManifest,
} from "./projects.js";


const PORT = Number(process.env.PORT ?? 8787);
const HAS_KEY = Boolean(process.env.OPENROUTER_API_KEY);

const app = express();
app.use(express.json({ limit: "50mb" }));
let mutating = false;
app.use("/api", (req, res, next) => {
  if (req.method !== "POST" && !(req.method === "GET" && req.path.startsWith("/projects/export/"))) return next();
  if (mutating) { res.status(409).json({ error: "Another operation is in progress. Please try again." }); return; }
  mutating = true;
  let released = false;
  const release = () => { if (!released) { released = true; mutating = false; } };
  res.once("finish", release);
  res.once("close", release);
  next();
});
app.use("/api", (req, res, next) => {
  const name = req.get("X-Project-Name");
  const spriteId = req.get("X-Sprite-Id");
  if (!name && !spriteId) return next();
  try {
    safeProjectName(name ?? "");
    if (spriteId) safeAssetId(spriteId);
    const animationId = req.get("X-Animation-Id");
    if (animationId) safeAssetId(animationId);
    projectContext.run({ name: name!, spriteId: spriteId ?? "", animationId: animationId || undefined }, next);
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
  res.json({ ok: true, hasApiKey: HAS_KEY, hasElevenLabsApiKey: Boolean(process.env.ELEVENLABS_API_KEY) });
});

app.get("/api/models/video", (_req, res) => {
  res.json({ models: VIDEO_MODELS, default: DEFAULT_VIDEO_MODEL });
});

app.get("/api/models/image", (_req, res) => {
  res.json({ models: IMAGE_MODELS, default: DEFAULT_IMAGE_MODEL });
});

app.get("/api/models/music", (_req, res) => {
  res.json({ models: MUSIC_MODELS, default: DEFAULT_MUSIC_MODEL, hasApiKey: Boolean(process.env.ELEVENLABS_API_KEY) });
});

function musicId(req: Request): string {
  const id = req.get("X-Music-Id");
  if (!id) throw new Error("Select a music track first (X-Music-Id is required)");
  return safeAssetId(id);
}

app.get("/api/music", async (req, res) => {
  try { res.json(await musicView(req.get("X-Music-Id"))); }
  catch (err) { handleError(err, res); }
});

app.post("/api/music/draft", async (req, res) => {
  try { res.json(await saveMusicDraft(musicId(req), req.body)); }
  catch (err) { handleError(err, res); }
});

app.post("/api/music/generate", async (req, res) => {
  let staged: string | undefined;
  try {
    const id = musicId(req);
    await readMusic(id);
    const settings = validateMusicSettings(req.body);
    const revision = newMusicRevision(id);
    staged = musicFile(id, revision);
    const source = `${revision}/source.mp3`;
    const audio = `${revision}/${id}.wav`;
    const data = await generateMusic(settings);
    await mkdir(staged, { recursive: true });
    await writeFile(musicFile(id, source), data);
    const pcm = await decodeMusic(musicFile(id, source));
    await writeFile(musicFile(id, audio), prepareMusicWav(pcm));
    const view = await commitMusicOutput(id, { ...settings, source, audio,
      crossfadeSeconds: 0, actualDuration: pcm.length / (MUSIC_SAMPLE_RATE * 4), createdAt: new Date().toISOString() });
    staged = undefined;
    res.json(view);
  } catch (err) {
    if (staged) await rm(staged, { recursive: true, force: true }).catch(() => {});
    handleError(err, res);
  }
});

app.post("/api/music/delete", async (req, res) => {
  try { res.json(await deleteMusic(musicId(req))); }
  catch (err) { handleError(err, res); }
});

app.post("/api/music/:action", async (req, res) => {
  try {
    const action = req.params.action;
    if (action !== "new" && action !== "load" && action !== "rename") throw new Error("Unknown music action");
    res.json(await changeMusic(action, asString(req.body?.value, "Music name", 60),
      action === "rename" ? musicId(req) : undefined));
  } catch (err) { handleError(err, res); }
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

app.get("/api/projects/export/:name", async (req, res) => {
  let archive: string | undefined;
  try {
    const name = safeProjectName(req.params.name);
    archive = await createProjectArchive(name);
    const output = archive;
    res.download(output, `${name}.zip`, error => {
      void removeArchive(output);
      if (error && !res.headersSent) handleError(error, res);
    });
  } catch (err) {
    if (archive) await removeArchive(archive);
    handleError(err, res);
  }
});

app.post("/api/projects/import", async (req, res) => {
  let archive: string | undefined;
  try {
    if (req.get("Content-Type") !== "application/zip") throw new Error("Select a ZIP project archive");
    const renameTo = req.get("X-Import-Name");
    const mode = req.get("X-Import-Mode");
    if (mode && mode !== "replace") throw new Error("Invalid import mode");
    if (renameTo) safeProjectName(renameTo);
    if (renameTo && mode === "replace") throw new Error("Choose either a new name or replace");
    archive = await receiveProjectArchive(req);
    const name = await importProjectArchive(archive, { renameTo, replace: mode === "replace" });
    res.json({ name });
  } catch (err) {
    if (err instanceof ProjectImportConflict) {
      res.status(409).json({ error: err.message, existingName: err.existingName });
    } else handleError(err, res);
  }
  finally { if (archive) await removeArchive(archive); }
});

app.post("/api/projects/save", async (_req, res) => {
  try {
    const current = await readManifest();
    res.json(current.project!.activeSpriteId ? await updateSprite({}).then(toView) : toView(current));
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

app.post("/api/projects/sprites/delete", async (_req, res) => {
  try { res.json(await deleteSprite()); }
  catch (err) { handleError(err, res); }
});

app.post("/api/projects/sprites/:action", async (req, res) => {
  try {
    const action = req.params.action;
    if (action !== "new" && action !== "load" && action !== "rename") throw new Error("Unknown sprite action");
    res.json(await changeSprite(action, asString(req.body?.value, "value", 60)));
  } catch (err) { handleError(err, res); }
});

app.post("/api/projects/animations/delete", async (_req, res) => {
  try { res.json(await deleteAnimation()); }
  catch (err) { handleError(err, res); }
});

app.post("/api/projects/animations/:action", async (req, res) => {
  try {
    const action = req.params.action;
    if (action !== "new" && action !== "load" && action !== "rename" && action !== "duplicate") throw new Error("Unknown animation action");
    res.json(await changeAnimation(action, asString(req.body?.value, "value", 60)));
  } catch (err) { handleError(err, res); }
});

app.post("/api/sprites/reference-image", async (req, res) => {
  let staged: string | undefined;
  try {
    if (!req.get("X-Project-Name") || !req.get("X-Sprite-Id")) throw new Error("Select a character first (X-Sprite-Id is required)");
    await readManifest();
    const image = await stageReferenceImage(req.body?.image);
    staged = image ? spriteFile(image.path) : undefined;
    await commitReferenceImage(image);
    staged = undefined;
    res.json({ referenceImage: toView(await readManifest()).referenceImage });
  } catch (err) {
    if (staged) await rm(path.dirname(staged), { recursive: true, force: true }).catch(() => {});
    handleError(err, res);
  }
});

app.post("/api/projects/draft", async (req, res) => {
  try {
    const patch: Partial<ProjectManifest> = {
      spritePrompt: validatePrompt(req.body?.spritePrompt, "Character prompt", true),
      motionPrompt: validatePrompt(req.body?.motionPrompt, "Movement prompt", true),
    };
    if (req.body?.styleId !== undefined) patch.styleId = validateCharacterStyleId(req.body.styleId);
    for (const key of ["spriteModel", "motionModel"] as const) {
      const value = req.body?.[key];
      if (typeof value !== "string" || value.length > 2000) throw new Error(`Invalid ${key}: expected a model ID of up to 2,000 characters`);
      patch[key] = value;
    }
    if (req.body?.frameSize !== undefined) {
      if (!req.get("X-Animation-Id")) throw new Error("Select an animation first (X-Animation-Id is required)");
      patch.frameSize = validateFrameSize(req.body.frameSize);
    }
    const current = await readManifest();
    for (const key of ["startImage", "endImage"] as const) {
      if (req.body?.[key] === undefined) continue;
      if (current.activeAnimationId && !req.get("X-Animation-Id")) throw new Error("Select an animation first (X-Animation-Id is required)");
      patch[key] = await stageAnimationImage(current, req.body[key], current[key]);
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
    const current = await readManifest();
    if (!Array.isArray(indices) || indices.some(i => !Number.isInteger(i) || i < 0 || i >= current.frames.length) ||
        new Set(indices).size !== indices.length) throw new Error("Invalid frame selection");
    const m = await updateSprite({ selectedFrameIndices: indices });
    res.json(toView(m));
  } catch (err) {
    handleError(err, res);
  }
});

app.post("/api/projects/spritesheet", async (req, res) => {
  try {
    if (!req.get("X-Animation-Id")) throw new Error("Select an animation first (X-Animation-Id is required)");
    const current = await readManifest();
    if (!current.activeAnimationId) throw new Error("Add an animation first");
    const dataUrl = asString(req.body?.dataUrl, "dataUrl", 50_000_000);
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new Error("Expected a PNG spritesheet");
    const frameSize = validateFrameSize(req.body?.frameSize === undefined ? current.frameSize : req.body.frameSize);
    const png = Buffer.from(match[1], "base64");
    const dimensions = readPngDims(png);
    if (!dimensions || dimensions.h !== frameSize || dimensions.w !== frameSize * current.selectedFrameIndices.length) {
      throw new Error("Spritesheet dimensions must match the selected frame size and frame count");
    }
    const name = assetName(current.animations.find(a => a.id === current.activeAnimationId)!.name);
    const assets = await stageAnimationAssets(png, current.selectedFrameIndices.length, name, current.activeAnimationId);
    let m = await updateSprite({ ...assets, frameSize, spritesheetFrameSize: frameSize,
      spritesheetFrameCount: current.selectedFrameIndices.length, previewGif: null });

    // Best-effort preview from the same composed frames, in the new output revision.
    try {
      const gifName = await buildPreviewGif(assets.spritesheet, m.spritesheetFrameCount!, path.posix.dirname(assets.spritesheet));
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
  let staged: string | undefined;
  try {
    const current = await readManifest();
    if (!current.project!.activeSpriteId) throw new Error("Add a character first");
    const prompt = validatePrompt(req.body?.prompt, "Character prompt");
    const requestedModel = req.body?.model;
    if (requestedModel !== undefined && !isImageModelId(requestedModel)) {
      throw new Error("unsupported image model");
    }
    const model = requestedModel ?? DEFAULT_IMAGE_MODEL;
    const styleId = req.body?.styleId === undefined ? current.styleId : validateCharacterStyleId(req.body.styleId);
    const generated = await generateCharacterReferences(characterImagePrompt(prompt, styleId), model,
      await referenceImageDataUrl(current.referenceImage));
    staged = generated.directory;

    await commitCharacterReferences({
      spritePrompt: prompt,
      styleId,
      referenceStyleId: styleId,
      spriteModel: model,
      sprite: generated.referenceViews.side,
      referenceViews: generated.referenceViews,
      referenceAlignment: generated.referenceAlignment,
      spriteDimensions: generated.spriteDimensions,
    });
    staged = undefined;

    res.json({
      view: toView(await readManifest()),
      dataUrl: generated.dataUrl,
    });
  } catch (err) {
    if (staged) await rm(staged, { recursive: true, force: true }).catch(() => {});
    handleError(err, res);
  }
});

app.post("/api/sprites/animate", requireKey, async (req, res) => {
  try {
    const current = await readManifest();
    if (!req.get("X-Animation-Id") || !current.activeAnimationId) throw new Error("Select an animation first (X-Animation-Id is required)");
    if (req.body?.model !== undefined && !isVideoModelId(req.body.model)) throw new Error("Unsupported video model");
    const text = validatePrompt(req.body?.text, "Movement prompt");
    const model = isVideoModelId(req.body?.model) ? req.body.model : DEFAULT_VIDEO_MODEL;
    const duration =
      typeof req.body?.duration === "number" ? req.body.duration : defaultDurationFor(model);

    const startImage = req.body?.startImage === undefined ? current.startImage
      : await stageAnimationImage(current, req.body.startImage, current.startImage);
    const endImage = req.body?.endImage === undefined ? current.endImage
      : await stageAnimationImage(current, req.body.endImage, current.endImage);
    const readImage = async (relative: string) => `data:image/png;base64,${(await readFile(spriteFile(relative))).toString("base64")}`;
    const startInput = startImage ? await readImage(startImage.path) : undefined;
    const imageInput = startInput ?? (current.sprite ? await readImage(current.sprite)
      : await resolveImageInput(asImageRef(req.body?.image)));

    const video = await generateSpriteMotionVideo(imageInput, text, duration, model,
      { startImage: startInput, endImage: endImage ? await readImage(endImage.path) : undefined,
        stylePrompt: characterStyle(current.referenceStyleId)?.motionPrompt,
        ...(!startImage && !endImage && model === "minimax/hailuo-3-max" ? { characterPrompt: current.spritePrompt } : {}) });
    const prefix = animationPath(current.activeAnimationId, `runs/${crypto.randomUUID()}`);
    const videoAbs = path.join(activeSpriteDir(), prefix, PROJECT_FILES.source);
    await downloadVideo(video.url, videoAbs, video.headers);

    const framesAbs = path.join(activeSpriteDir(), prefix, PROJECT_FILES.framesDir);
    const frameFiles = await extractFrames(videoAbs, framesAbs);
    const frames = frameFiles.map((f) => `${prefix}/${PROJECT_FILES.framesDir}/${f}`);

    const m = await updateSprite({
      motionPrompt: text,
      motionModel: model,
      startImage,
      endImage,
      frames,
      selectedFrameIndices: frames.map((_, i) => i),
      spritesheet: null,
      spritesheetFrameCount: null,
      spritesheetFrameSize: null,
      aseprite: null,
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
  return redactProviderError(msg);
}

const server = app.listen(PORT, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  console.log(`[server] listening on http://localhost:${port}`);
  if (!HAS_KEY) {
    console.warn("[server] WARNING: OPENROUTER_API_KEY is missing — character and animation generation are unavailable");
  }
});
