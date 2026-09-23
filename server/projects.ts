import { mkdir, readFile, readdir, rm, writeFile, rename, stat, cp, copyFile } from "node:fs/promises";
import path from "node:path";
import { stageAnimationAssets } from "./animation-assets.js";
import { deleteAssetFolder } from "./asset-storage.js";
import { readPngDims } from "./files.js";
import { DEFAULT_IMAGE_MODEL } from "./image.js";
import type { SavedReferenceImage } from "./reference-image.js";
import type { ReferenceImageAttachment } from "../src/lib/reference-image.js";
import { DEFAULT_FRAME_SIZE, type FrameSize } from "../src/lib/frame-size.js";
import { createHash, randomUUID } from "node:crypto";
import { REFERENCE_VIEWS, REFERENCE_LABELS, sourceKey, type ReferenceView, type ImageSource,
  type ImageSourceOption } from "../src/lib/character.js";
import { PROJECTS_DIR, PROJECT_FILES, projectDir, safeProjectName, safeAssetId, spriteFile,
  currentProjectName, projectContext, ensureInsideRoot } from "./files.js";

export interface ProjectDocument {
  version: 1;
  name: string;
  activeSpriteId: string;
  sprites: { id: string; name: string; path: string }[];
  activeMusicId?: string;
  music?: { id: string; name: string; path: string }[];
}

export interface AnimationSummary { id: string; name: string }
export interface SavedAnimationImage {
  source: ImageSource;
  label: string;
  path: string;
}
export interface ReferenceAlignment { canvasSize: number; height: number; top: number; centerX: number }
interface AnimationManifest extends AnimationSummary {
  frameSize?: FrameSize;
  spritesheetFrameSize?: number | null;
  startImage?: SavedAnimationImage | null;
  endImage?: SavedAnimationImage | null;
  motionPrompt: string;
  motionModel: string;
  frames: string[];
  selectedFrameIndices: number[];
  spritesheet: string | null;
  spritesheetFrameCount: number | null;
  aseprite: string | null;
  previewGif: string | null;
  updatedAt: string;
}
interface CharacterManifest {
  referenceImage?: SavedReferenceImage | null;
  version: 2;
  name: string;
  spritePrompt: string;
  spriteModel: string;
  sprite: string | null;
  spriteDimensions: { w: number; h: number } | null;
  referenceViews?: Partial<Record<ReferenceView, string>>;
  referenceAlignment?: ReferenceAlignment | null;
  activeAnimationId: string;
  animations: AnimationSummary[];
  updatedAt: string;
}

export interface ProjectManifest {
  frameSize: FrameSize;
  spritesheetFrameSize: number | null;
  referenceImage: SavedReferenceImage | null;
  referenceViews: Partial<Record<ReferenceView, string>>;
  referenceAlignment: ReferenceAlignment | null;
  startImage: SavedAnimationImage | null;
  endImage: SavedAnimationImage | null;
  imageSources: ImageSourceOption[];
  project?: ProjectDocument;
  activeAnimationId: string;
  animations: AnimationSummary[];
  aseprite: string | null;
  name: string;
  spritePrompt: string;
  spriteModel: string;
  motionPrompt: string;
  motionModel: string;
  sprite: string | null;
  spriteDimensions: { w: number; h: number } | null;
  frames: string[];
  selectedFrameIndices: number[];
  spritesheet: string | null;
  spritesheetFrameCount: number | null;
  previewGif: string | null;
  updatedAt: string;
}

export interface ProjectView {
  frameSize: FrameSize;
  spritesheetFrameSize: number | null;
  referenceImage: ReferenceImageAttachment | null;
  referenceViews: Partial<Record<ReferenceView, string>>;
  referenceAlignment: ReferenceAlignment | null;
  startImage: ImageSourceOption | null;
  endImage: ImageSourceOption | null;
  imageSources: ImageSourceOption[];
  project: ProjectDocument;
  activeAnimationId: string;
  animations: AnimationSummary[];
  asepriteUrl: string | null;
  name: string;
  spritePrompt: string;
  spriteModel: string;
  motionPrompt: string;
  motionModel: string;
  spriteUrl: string | null;
  spriteDimensions: { w: number; h: number } | null;
  frames: string[];
  selectedFrameIndices: number[];
  spritesheetUrl: string | null;
  spritesheetFrameCount: number | null;
  previewGifUrl: string | null;
  updatedAt: string;
}

export function emptyManifest(name: string): ProjectManifest {
  return {
    frameSize: DEFAULT_FRAME_SIZE,
    spritesheetFrameSize: null,
    referenceImage: null,
    referenceViews: {}, referenceAlignment: null, startImage: null, endImage: null, imageSources: [],
    name,
    activeAnimationId: "",
    animations: [],
    aseprite: null,
    spritePrompt: "",
    spriteModel: DEFAULT_IMAGE_MODEL,
    motionPrompt: "",
    motionModel: "x-ai/grok-imagine-video",
    sprite: null,
    spriteDimensions: null,
    frames: [],
    selectedFrameIndices: [],
    spritesheet: null,
    spritesheetFrameCount: null,
    previewGif: null,
    updatedAt: new Date().toISOString(),
  };
}


export async function writeJson(file: string, value: unknown): Promise<void> {
  ensureInsideRoot(file);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, file);
}

export async function readProjectDocument(name: string): Promise<ProjectDocument> {
  const doc = JSON.parse(await readFile(path.join(projectDir(name), ".project"), "utf8")) as ProjectDocument;
  if (doc.version !== 1 || doc.name !== name || !Array.isArray(doc.sprites) ||
      (doc.sprites.length ? !doc.sprites.some(s => s.id === doc.activeSpriteId) : doc.activeSpriteId !== "")) throw new Error("Invalid .project manifest");
  for (const sprite of doc.sprites) {
    safeAssetId(sprite.id);
    if (typeof sprite.name !== "string" || sprite.path !== `sprites/${sprite.id}/sprite.json`) throw new Error("Invalid sprite entry");
  }
  if (doc.music !== undefined) {
    if (!Array.isArray(doc.music) || (doc.music.length
      ? !doc.music.some(track => track.id === doc.activeMusicId)
      : !!doc.activeMusicId)) throw new Error("Invalid project music entries");
    for (const track of doc.music) {
      safeAssetId(track.id);
      if (track.name !== track.id || track.path !== `music/${track.id}/music.json`) throw new Error("Invalid music entry");
    }
  }
  return doc;
}

export async function writeProjectDocument(doc: ProjectDocument): Promise<void> {
  await writeJson(path.join(projectDir(doc.name), ".project"), doc);
}

export function assetName(name: string): string {
  const stem = name.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!stem || stem.length > 60) throw new Error("Use a name with 1–60 letters, numbers, hyphens or underscores");
  return stem;
}

export function animationPath(id: string, file = ""): string {
  safeAssetId(id);
  return path.posix.join("animations", id, file);
}

async function characterManifest(): Promise<CharacterManifest> {
  const doc = await readProjectDocument(currentProjectName());
  const entry = doc.sprites.find(s => s.id === projectContext.getStore()!.spriteId);
  if (!entry) throw new Error("Character not found");
  const file = spriteFile(PROJECT_FILES.manifest);
  const parsed = JSON.parse(await readFile(file, "utf8"));
  if (parsed.version === 2) return parsed as CharacterManifest;
  // Copy legacy outputs before committing the new manifest; old files remain recoverable.
  const legacy = { ...emptyManifest(doc.name), ...parsed } as ProjectManifest;
  const id = "animation-1";
  const prefix = animationPath(id);
  const animation: AnimationManifest = {
    id, name: `${assetName(entry.name).slice(0, 50)}-animation`, motionPrompt: legacy.motionPrompt,
    motionModel: legacy.motionModel, frames: legacy.frames.map(f => `${prefix}/${f}`),
    selectedFrameIndices: legacy.selectedFrameIndices, spritesheet: legacy.spritesheet ? `${prefix}/${legacy.spritesheet}` : null,
    spritesheetFrameCount: null,
    aseprite: legacy.aseprite ? `${prefix}/${legacy.aseprite}` : null,
    previewGif: legacy.previewGif ? `${prefix}/${legacy.previewGif}` : null, updatedAt: legacy.updatedAt,
  };
  const destination = spriteFile(prefix);
  await mkdir(destination, { recursive: true });
  for (const relative of [PROJECT_FILES.framesDir, PROJECT_FILES.source, legacy.spritesheet, legacy.aseprite, legacy.previewGif]) {
    if (!relative) continue;
    const source = spriteFile(relative);
    ensureInsideRoot(source);
    const target = spriteFile(prefix, relative);
    try { await cp(source, target, { recursive: true }); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
  }
  if (legacy.spritesheet) {
    const png = await readFile(spriteFile(legacy.spritesheet));
    const dims = readPngDims(png);
    const count = dims ? dims.w / dims.h : 0;
    Object.assign(animation, await stageAnimationAssets(png, count, animation.name, id),
      { spritesheetFrameCount: count, spritesheetFrameSize: dims!.h });
  }
  let reference = legacy.sprite;
  if (reference) {
    const source = spriteFile(reference);
    ensureInsideRoot(source);
    reference = `${assetName(entry.name)}.png`;
    if (source !== spriteFile(reference)) await copyFile(source, spriteFile(reference));
  }
  const character: CharacterManifest = {
    version: 2, name: doc.name, spritePrompt: legacy.spritePrompt, spriteModel: legacy.spriteModel,
    sprite: reference, spriteDimensions: legacy.spriteDimensions, activeAnimationId: id,
    animations: [{ id, name: animation.name }], updatedAt: legacy.updatedAt,
  };
  await writeJson(path.join(destination, "animation.json"), animation);
  await writeJson(file, character);
  return character;
}

export async function readManifest(): Promise<ProjectManifest> {
  const doc = await readProjectDocument(currentProjectName());
  const context = projectContext.getStore()!;
  if (!context.spriteId && !doc.sprites.length) return { ...emptyManifest(doc.name), project: doc };
  const character = await characterManifest();
  const referenceViews = character.referenceViews ?? (character.sprite ? { side: character.sprite } : {});
  const revisionFor = (file: string) => createHash("sha256").update(file).digest("hex").slice(0, 16);
  const imageSources: ImageSourceOption[] = REFERENCE_VIEWS.flatMap(view => {
    const url = referenceViews[view];
    return url ? [{ source: { kind: "reference" as const, view, revision: revisionFor(url) }, label: REFERENCE_LABELS[view], url }] : [];
  });
  for (const summary of character.animations) {
    const animation = JSON.parse(await readFile(spriteFile(animationPath(summary.id, "animation.json")), "utf8")) as AnimationManifest;
    const indices = [...new Set(animation.selectedFrameIndices)].filter(i => Number.isInteger(i) && !!animation.frames[i]).sort((a, b) => a - b);
    if (!indices.length) continue;
    for (const edge of ["first", "last"] as const) {
      const url = animation.frames[edge === "first" ? indices[0] : indices[indices.length - 1]];
      imageSources.push({ source: { kind: "animation", animationId: summary.id, edge, revision: revisionFor(url) },
        label: `${summary.name} · ${edge} included frame`, url });
    }
  }
  const references = { referenceViews, referenceAlignment: character.referenceAlignment ?? null, imageSources };
  const id = context.animationId ?? character.activeAnimationId;
  if (!id && !character.animations.length) return { ...emptyManifest(doc.name), ...character, ...references,
    project: { ...doc, activeSpriteId: context.spriteId } };
  if (!character.animations.some(a => a.id === id)) throw new Error("Animation not found");
  const animation = JSON.parse(await readFile(spriteFile(animationPath(id, "animation.json")), "utf8")) as AnimationManifest;
  return { ...emptyManifest(doc.name), ...character, ...animation, ...references, name: doc.name, activeAnimationId: id,
    frameSize: animation.frameSize ?? DEFAULT_FRAME_SIZE,
    spritesheetFrameSize: animation.spritesheet ? animation.spritesheetFrameSize ?? DEFAULT_FRAME_SIZE : null,
    spriteModel: character.spriteModel === "openai/gpt-image-2.5-sunburst" ? DEFAULT_IMAGE_MODEL : character.spriteModel,
    project: { ...doc, activeSpriteId: context.spriteId } };
}

export async function updateSprite(patch: Partial<ProjectManifest>): Promise<ProjectManifest> {
  const current = await readManifest();
  const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
  const character = await characterManifest();
  for (const key of ["spritePrompt", "spriteModel", "sprite", "spriteDimensions", "referenceViews", "referenceAlignment"] as const) {
    Object.assign(character, { [key]: updated[key] });
  }
  character.activeAnimationId = current.activeAnimationId;
  character.updatedAt = updated.updatedAt;
  const summary = character.animations.find(a => a.id === current.activeAnimationId)!;
  if (summary) {
  const animation: AnimationManifest = { ...summary, motionPrompt: updated.motionPrompt, motionModel: updated.motionModel,
    frameSize: updated.frameSize, spritesheetFrameSize: updated.spritesheetFrameSize,
    startImage: updated.startImage, endImage: updated.endImage,
    frames: updated.frames, selectedFrameIndices: updated.selectedFrameIndices, spritesheet: updated.spritesheet,
    spritesheetFrameCount: updated.spritesheetFrameCount, aseprite: updated.aseprite, previewGif: updated.previewGif, updatedAt: updated.updatedAt };
  await writeJson(spriteFile(animationPath(summary.id, "animation.json")), animation);
  }
  await writeJson(spriteFile(PROJECT_FILES.manifest), character);
  await writeProjectDocument(updated.project!);
  return readManifest();
}

export async function commitCharacterReferences(patch: Pick<ProjectManifest,
  "spritePrompt" | "spriteModel" | "sprite" | "spriteDimensions" | "referenceViews" | "referenceAlignment">): Promise<void> {
  const character = await characterManifest();
  await writeJson(spriteFile(PROJECT_FILES.manifest), { ...character, ...patch, updatedAt: new Date().toISOString() });
}

export async function commitReferenceImage(referenceImage: SavedReferenceImage | null): Promise<void> {
  const character = await characterManifest();
  await writeJson(spriteFile(PROJECT_FILES.manifest), { ...character, referenceImage, updatedAt: new Date().toISOString() });
}

/** Validate a picker value, then copy the exact pose into the target animation.
 * Saved endpoints survive source regeneration, selection changes, renames and deletion. */
export function validateImageSource(value: unknown): ImageSource | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new Error("Invalid animation image source");
  const source = value as Record<string, unknown>;
  if (source.revision !== undefined && (typeof source.revision !== "string" || !/^[a-f0-9]{16}$/.test(source.revision))) {
    throw new Error("Invalid image source revision");
  }
  const revision = source.revision ? { revision: source.revision as string } : {};
  if (source.kind === "reference" && REFERENCE_VIEWS.includes(source.view as ReferenceView)) {
    return { kind: "reference", view: source.view as ReferenceView, ...revision };
  }
  if (source.kind === "animation" && typeof source.animationId === "string" && (source.edge === "first" || source.edge === "last")) {
    return { kind: "animation", animationId: safeAssetId(source.animationId), edge: source.edge, ...revision };
  }
  throw new Error("Invalid animation image source");
}

export async function stageAnimationImage(current: ProjectManifest, value: unknown, previous: SavedAnimationImage | null) {
  const source = validateImageSource(value);
  if (!source) return null;
  if (!current.activeAnimationId) throw new Error("Add an animation first");
  const matches = (candidate: ImageSource) => sourceKey(source.revision ? candidate : { ...candidate, revision: undefined }) === sourceKey(source);
  if (previous && matches(previous.source)) return previous;
  const option = current.imageSources.find(option => matches(option.source));
  if (!option) throw new Error("That image source is no longer available. Choose another pose.");
  const input = spriteFile(option.url);
  const png = await readFile(input);
  if (!readPngDims(png)) throw new Error("Image source is not a PNG");
  const relative = animationPath(current.activeAnimationId, `inputs/${randomUUID()}.png`);
  await mkdir(path.dirname(spriteFile(relative)), { recursive: true });
  await writeFile(spriteFile(relative), png);
  return { source: option.source, label: option.label, path: relative };
}

export function toView(m: ProjectManifest): ProjectView {
  const doc = m.project!;
  const base = `/projects/${encodeURIComponent(doc.name)}/sprites/${encodeURIComponent(doc.activeSpriteId)}/`;
  const endpointView = (image: SavedAnimationImage | null): ImageSourceOption | null => image ? {
    source: image.source,
    label: image.source.kind === "reference" ? REFERENCE_LABELS[image.source.view] : image.label,
    url: base + image.path,
  } : null;
  return { project: doc, name: doc.name, activeAnimationId: m.activeAnimationId, animations: m.animations,
    frameSize: m.frameSize, spritesheetFrameSize: m.spritesheetFrameSize,
    referenceImage: m.referenceImage ? { name: m.referenceImage.name, url: base + m.referenceImage.path } : null,
    referenceViews: Object.fromEntries(Object.entries(m.referenceViews).map(([view, file]) => [view, base + file])),
    referenceAlignment: m.referenceAlignment,
    startImage: endpointView(m.startImage),
    endImage: endpointView(m.endImage),
    imageSources: m.imageSources.map(option => ({ ...option, url: base + option.url })),
    asepriteUrl: m.aseprite ? base + m.aseprite : null, spritePrompt: m.spritePrompt, spriteModel: m.spriteModel,
    motionPrompt: m.motionPrompt, motionModel: m.motionModel,
    spriteUrl: m.sprite ? base + m.sprite : null, spriteDimensions: m.spriteDimensions,
    frames: m.frames.map(f => base + f), selectedFrameIndices: m.selectedFrameIndices,
    spritesheetFrameCount: m.spritesheetFrameCount,
    spritesheetUrl: m.spritesheet ? base + m.spritesheet : null,
    previewGifUrl: m.previewGif ? base + m.previewGif : null, updatedAt: m.updatedAt };
}

async function moveFolder(source: string, target: string, commit: () => Promise<void>): Promise<void> {
  ensureInsideRoot(source);
  ensureInsideRoot(target);
  if (source === target) { await commit(); return; }
  const sourceStat = await stat(source);
  try {
    const targetStat = await stat(target);
    if (sourceStat.ino !== targetStat.ino || sourceStat.dev !== targetStat.dev) throw new Error("A folder with that name already exists");
  } catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
  const temporary = `${source}.${randomUUID()}.renaming`;
  await rename(source, temporary);
  try { await rename(temporary, target); }
  catch (err) { await rename(temporary, source); throw err; }
  try { await commit(); }
  catch (err) { await rename(target, source); throw err; }
}

async function renameAnimationFolder(character: CharacterManifest, id: string, name: string): Promise<void> {
  const original = JSON.parse(await readFile(spriteFile(animationPath(id, "animation.json")), "utf8")) as AnimationManifest;
  const animation = { ...original, id: name, name, updatedAt: new Date().toISOString() };
  const oldPrefix = animationPath(id) + "/";
  const newPrefix = animationPath(name) + "/";
  const remap = (file: string) => file.startsWith(oldPrefix) ? newPrefix + file.slice(oldPrefix.length) : file;
  animation.frames = original.frames.map(remap);
  for (const key of ["startImage", "endImage"] as const) {
    animation[key] = original[key] ? { ...original[key], path: remap(original[key].path) } : null;
  }
  for (const key of ["spritesheet", "aseprite", "previewGif"] as const) animation[key] = original[key] ? remap(original[key]) : null;
  const updated = { ...character, animations: character.animations.map(a => a.id === id ? { id: name, name } : a),
    activeAnimationId: character.activeAnimationId === id ? name : character.activeAnimationId,
    updatedAt: animation.updatedAt };
  await moveFolder(spriteFile(animationPath(id)), spriteFile(animationPath(name)), async () => {
    try {
      for (const key of ["spritesheet", "aseprite"] as const) {
        const old = animation[key];
        if (!old) continue;
        const next = path.posix.join(path.posix.dirname(old), `${name}${key === "spritesheet" ? ".png" : ".aseprite"}`);
        if (old !== next) await copyFile(spriteFile(old), spriteFile(next));
        animation[key] = next;
      }
      await writeJson(spriteFile(animationPath(name, "animation.json")), animation);
      await writeJson(spriteFile(PROJECT_FILES.manifest), updated);
    } catch (err) {
      await writeJson(spriteFile(animationPath(name, "animation.json")), original);
      throw err;
    }
  });
}

async function renameCharacterFolder(doc: ProjectDocument, id: string, name: string): Promise<void> {
  const character = await characterManifest();
  const sprite = character.referenceAlignment ? character.referenceViews?.side ?? character.sprite
    : character.sprite ? `${name}.png` : null;
  const updated = { ...character, sprite, referenceViews: character.referenceViews
    ? { ...character.referenceViews, ...(sprite ? { side: sprite } : {}) } : undefined, updatedAt: new Date().toISOString() };
  const updatedDoc = { ...doc, activeSpriteId: doc.activeSpriteId === id ? name : doc.activeSpriteId,
    sprites: doc.sprites.map(s => s.id === id ? { id: name, name, path: `sprites/${name}/sprite.json` } : s) };
  const target = path.join(projectDir(doc.name), "sprites", name);
  await moveFolder(spriteFile(), target, async () => {
    try {
      if (character.sprite && character.sprite !== updated.sprite) {
        await copyFile(path.join(target, character.sprite), path.join(target, updated.sprite!));
      }
      await writeJson(path.join(target, "sprite.json"), updated);
      await writeProjectDocument(updatedDoc);
    } catch (err) {
      await writeJson(path.join(target, "sprite.json"), character);
      throw err;
    }
  });
}

async function duplicateAnimationFolder(character: CharacterManifest, id: string, name: string): Promise<void> {
  const source = spriteFile(animationPath(id));
  const destination = spriteFile(animationPath(name));
  const original = JSON.parse(await readFile(path.join(source, "animation.json"), "utf8")) as AnimationManifest;
  const prefix = animationPath(id) + "/";
  const remap = (file: string): string => {
    if (!file.startsWith(prefix) || !spriteFile(file).startsWith(source + path.sep)) {
      throw new Error("Animation asset is outside its animation folder");
    }
    return animationPath(name, file.slice(prefix.length));
  };
  const animation: AnimationManifest = { ...original, id: name, name, updatedAt: new Date().toISOString(),
    frames: original.frames.map(remap) };
  for (const key of ["startImage", "endImage"] as const) {
    animation[key] = original[key] ? { ...original[key], path: remap(original[key].path) } : null;
  }
  for (const key of ["spritesheet", "aseprite", "previewGif"] as const) {
    animation[key] = original[key] ? remap(original[key]) : null;
  }
  // Reserve an independent folder; publish it only after every copied asset is ready.
  try { await mkdir(destination); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error("A folder with that name already exists");
    throw err;
  }
  try {
    for (const entry of await readdir(source)) {
      await cp(path.join(source, entry), path.join(destination, entry), { recursive: true, force: false, errorOnExist: true });
    }
    for (const file of [...animation.frames, animation.spritesheet, animation.aseprite, animation.previewGif]) {
      if (file) await stat(spriteFile(file));
    }
    for (const key of ["spritesheet", "aseprite"] as const) {
      const old = animation[key];
      if (!old) continue;
      const next = path.posix.join(path.posix.dirname(old), `${name}${key === "spritesheet" ? ".png" : ".aseprite"}`);
      if (old !== next) await copyFile(spriteFile(old), spriteFile(next));
      animation[key] = next;
    }
    await writeJson(path.join(destination, "animation.json"), animation);
    await writeJson(spriteFile(PROJECT_FILES.manifest), { ...character,
      animations: [...character.animations, { id: name, name }],
      activeAnimationId: name, updatedAt: animation.updatedAt });
  } catch (err) {
    await rm(destination, { recursive: true, force: true });
    throw err;
  }
}

export async function changeAnimation(action: "new" | "load" | "rename" | "duplicate", value: string): Promise<ProjectView> {
  if (action === "duplicate" && !projectContext.getStore()?.animationId) throw new Error("Select an animation to duplicate");
  const current = await readManifest();
  const character = await characterManifest();
  let id = current.activeAnimationId;
  if (action === "load") {
    if (!character.animations.some(a => a.id === value)) throw new Error("Animation not found");
    id = value;
  } else {
    const name = assetName(value);
    if (character.animations.some(a => a.name.toLowerCase() === name.toLowerCase() && (action !== "rename" || a.id !== id))) throw new Error("Animation name already exists");
    if (action === "new") {
      id = name;
      await mkdir(spriteFile("animations"), { recursive: true });
      await mkdir(spriteFile(animationPath(id)));
      character.animations.push({ id, name });
      await writeJson(spriteFile(animationPath(id, "animation.json")), {
        id, name, motionPrompt: "", motionModel: current.motionModel, frames: [], selectedFrameIndices: [],
        frameSize: DEFAULT_FRAME_SIZE, spritesheetFrameSize: null,
        spritesheet: null, spritesheetFrameCount: null, aseprite: null, previewGif: null, updatedAt: new Date().toISOString(),
      });
    } else {
      if (!id) throw new Error("Add an animation first");
      if (action === "duplicate") await duplicateAnimationFolder(character, id, name);
      else await renameAnimationFolder(character, id, name);
      return projectContext.run({ ...projectContext.getStore()!, animationId: name }, async () => toView(await readManifest()));
    }
  }
  character.activeAnimationId = id;
  character.updatedAt = new Date().toISOString();
  await writeJson(spriteFile(PROJECT_FILES.manifest), character);
  return projectContext.run({ ...projectContext.getStore()!, animationId: id }, async () => toView(await readManifest()));
}

export async function deleteAnimation(): Promise<ProjectView> {
  const id = projectContext.getStore()?.animationId;
  if (!id) throw new Error("Select an animation to delete");
  safeAssetId(id);
  const character = await characterManifest();
  const index = character.animations.findIndex(animation => animation.id === id);
  if (index < 0) throw new Error("Animation not found");
  character.animations.splice(index, 1);
  if (character.activeAnimationId === id) {
    character.activeAnimationId = character.animations[Math.min(index, character.animations.length - 1)]?.id ?? "";
  }
  character.updatedAt = new Date().toISOString();
  await deleteAssetFolder(spriteFile(animationPath(id)), () => writeJson(spriteFile(PROJECT_FILES.manifest), character));
  return projectContext.run({ ...projectContext.getStore()!, animationId: character.activeAnimationId || undefined },
    async () => toView(await readManifest()));
}

export async function listSavedProjects(): Promise<{ name: string; updatedAt: string }[]> {
  await mkdir(PROJECTS_DIR, { recursive: true });
  const result: { name: string; updatedAt: string }[] = [];
  for (const entry of await readdir(PROJECTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      await readProjectDocument(entry.name);
      const info = await stat(path.join(projectDir(entry.name), ".project"));
      result.push({ name: entry.name, updatedAt: info.mtime.toISOString() });
    } catch { /* Ignore unrelated or invalid directories. */ }
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function openProject(name: string): Promise<ProjectView> {
  let doc = await readProjectDocument(name);
  // Upgrade opaque folder IDs to the existing UI names, including inactive characters.
  const names = doc.sprites.map(s => assetName(s.name).toLowerCase());
  if (new Set(names).size !== names.length) throw new Error("Character names must be unique before migrating folders");
  for (const sprite of [...doc.sprites]) {
    await projectContext.run({ name, spriteId: sprite.id }, async () => {
      let character = await characterManifest();
      const animationNames = character.animations.map(a => assetName(a.name).toLowerCase());
      if (new Set(animationNames).size !== animationNames.length) throw new Error("Animation names must be unique before migrating folders");
      for (const animation of [...character.animations]) {
        const folder = assetName(animation.name);
        if (animation.id !== folder) {
          await renameAnimationFolder(character, animation.id, folder);
          character = await characterManifest();
        }
      }
      const folder = assetName(sprite.name);
      if (sprite.id !== folder) await renameCharacterFolder(doc, sprite.id, folder);
    });
    doc = await readProjectDocument(name);
  }
  return projectContext.run({ name, spriteId: doc.activeSpriteId }, async () => toView(await readManifest()));
}

export async function deleteSavedProject(name: string): Promise<void> {
  await readProjectDocument(name);
  await rm(projectDir(name), { recursive: true });
}

export async function changeSprite(action: "new" | "load" | "rename", value: string): Promise<ProjectView> {
  const doc = await readProjectDocument(currentProjectName());
  doc.activeSpriteId = projectContext.getStore()!.spriteId;
  if (action === "load" && !doc.sprites.some(s => s.id === value)) throw new Error("Character not found");
  if (action !== "load") {
    value = assetName(value);
    if (doc.sprites.some(s => assetName(s.name).toLowerCase() === value.toLowerCase() && (action === "new" || s.id !== doc.activeSpriteId))) throw new Error("Character name already exists");
  }
  if (action === "new") {
    const dir = path.join(projectDir(doc.name), "sprites", value);
    ensureInsideRoot(dir);
    await mkdir(path.dirname(dir), { recursive: true });
    await mkdir(dir);
    const character: CharacterManifest = { version: 2, name: doc.name, spritePrompt: "", spriteModel: DEFAULT_IMAGE_MODEL,
      sprite: null, spriteDimensions: null, activeAnimationId: "", animations: [], updatedAt: new Date().toISOString() };
    await writeJson(path.join(dir, "sprite.json"), character);
    doc.sprites.push({ id: value, name: value, path: `sprites/${value}/sprite.json` });
    doc.activeSpriteId = value;
  } else if (action === "load") doc.activeSpriteId = value;
  else {
    if (!doc.activeSpriteId) throw new Error("Add a character first");
    await renameCharacterFolder(doc, doc.activeSpriteId, value);
    return openProject(doc.name);
  }
  await writeProjectDocument(doc);
  return openProject(doc.name);
}

export async function deleteSprite(): Promise<ProjectView> {
  const id = projectContext.getStore()?.spriteId;
  if (!id) throw new Error("Select a character to delete (X-Sprite-Id is required)");
  safeAssetId(id);
  const doc = await readProjectDocument(currentProjectName());
  const index = doc.sprites.findIndex(sprite => sprite.id === id);
  if (index < 0) throw new Error("Character not found");
  doc.sprites.splice(index, 1);
  if (doc.activeSpriteId === id) {
    doc.activeSpriteId = doc.sprites[Math.min(index, doc.sprites.length - 1)]?.id ?? "";
  }
  await deleteAssetFolder(spriteFile(), () => writeProjectDocument(doc));
  // The next character owns a different animation selection; discard the old tab's animation header.
  return projectContext.run({ name: doc.name, spriteId: doc.activeSpriteId },
    async () => toView(await readManifest()));
}

export async function createProject(name: string): Promise<ProjectView> {
  safeProjectName(name);
  await mkdir(PROJECTS_DIR, { recursive: true });
  try { await mkdir(projectDir(name)); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error("A project with that name already exists");
    throw err;
  }
  const doc: ProjectDocument = { version: 1, name, activeSpriteId: "", sprites: [] };
  await writeProjectDocument(doc);
  return openProject(name);
}
