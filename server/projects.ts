import { mkdir, readFile, readdir, rm, writeFile, rename, stat, cp, copyFile } from "node:fs/promises";
import path from "node:path";
import { stageAnimationAssets } from "./animation-assets.js";
import { readPngDims } from "./files.js";
import { DEFAULT_IMAGE_MODEL } from "./image.js";
import { randomUUID } from "node:crypto";
import { PROJECTS_DIR, PROJECT_FILES, projectDir, safeProjectName, safeAssetId, spriteFile,
  currentProjectName, projectContext, ensureInsideRoot } from "./files.js";

export interface ProjectDocument {
  version: 1;
  name: string;
  activeSpriteId: string;
  sprites: { id: string; name: string; path: string }[];
}

export interface AnimationSummary { id: string; name: string }
interface AnimationManifest extends AnimationSummary {
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
  version: 2;
  name: string;
  spritePrompt: string;
  spriteModel: string;
  sprite: string | null;
  spriteDimensions: { w: number; h: number } | null;
  activeAnimationId: string;
  animations: AnimationSummary[];
  updatedAt: string;
}

export interface ProjectManifest {
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


async function writeJson(file: string, value: unknown): Promise<void> {
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
  return doc;
}

async function writeProjectDocument(doc: ProjectDocument): Promise<void> {
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
    Object.assign(animation, await stageAnimationAssets(png, count, animation.name, id), { spritesheetFrameCount: count });
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
  const id = context.animationId ?? character.activeAnimationId;
  if (!id && !character.animations.length) return { ...emptyManifest(doc.name), ...character,
    project: { ...doc, activeSpriteId: context.spriteId } };
  if (!character.animations.some(a => a.id === id)) throw new Error("Animation not found");
  const animation = JSON.parse(await readFile(spriteFile(animationPath(id, "animation.json")), "utf8")) as AnimationManifest;
  return { ...character, ...animation, name: doc.name, activeAnimationId: id,
    spriteModel: character.spriteModel === "openai/gpt-image-2.5-sunburst" ? DEFAULT_IMAGE_MODEL : character.spriteModel,
    project: { ...doc, activeSpriteId: context.spriteId } };
}

export async function updateSprite(patch: Partial<ProjectManifest>): Promise<ProjectManifest> {
  const current = await readManifest();
  const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
  const character = await characterManifest();
  for (const key of ["spritePrompt", "spriteModel", "sprite", "spriteDimensions"] as const) {
    Object.assign(character, { [key]: updated[key] });
  }
  character.activeAnimationId = current.activeAnimationId;
  character.updatedAt = updated.updatedAt;
  const summary = character.animations.find(a => a.id === current.activeAnimationId)!;
  if (summary) {
  const animation: AnimationManifest = { ...summary, motionPrompt: updated.motionPrompt, motionModel: updated.motionModel,
    frames: updated.frames, selectedFrameIndices: updated.selectedFrameIndices, spritesheet: updated.spritesheet,
    spritesheetFrameCount: updated.spritesheetFrameCount, aseprite: updated.aseprite, previewGif: updated.previewGif, updatedAt: updated.updatedAt };
  await writeJson(spriteFile(animationPath(summary.id, "animation.json")), animation);
  }
  await writeJson(spriteFile(PROJECT_FILES.manifest), character);
  await writeProjectDocument(updated.project!);
  return updated;
}

export function toView(m: ProjectManifest): ProjectView {
  const doc = m.project!;
  const base = `/projects/${encodeURIComponent(doc.name)}/sprites/${encodeURIComponent(doc.activeSpriteId)}/`;
  return { project: doc, name: doc.name, activeAnimationId: m.activeAnimationId, animations: m.animations,
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
  const updated = { ...character, sprite: character.sprite ? `${name}.png` : null, updatedAt: new Date().toISOString() };
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

export async function changeAnimation(action: "new" | "load" | "rename", value: string): Promise<ProjectView> {
  const current = await readManifest();
  const character = await characterManifest();
  let id = current.activeAnimationId;
  if (action === "load") {
    if (!character.animations.some(a => a.id === value)) throw new Error("Animation not found");
    id = value;
  } else {
    const name = assetName(value);
    if (character.animations.some(a => a.name.toLowerCase() === name.toLowerCase() && (action === "new" || a.id !== id))) throw new Error("Animation name already exists");
    if (action === "new") {
      id = name;
      await mkdir(spriteFile("animations"), { recursive: true });
      await mkdir(spriteFile(animationPath(id)));
      character.animations.push({ id, name });
      await writeJson(spriteFile(animationPath(id, "animation.json")), {
        id, name, motionPrompt: "", motionModel: current.motionModel, frames: [], selectedFrameIndices: [],
        spritesheet: null, spritesheetFrameCount: null, aseprite: null, previewGif: null, updatedAt: new Date().toISOString(),
      });
    } else {
      if (!id) throw new Error("Add an animation first");
      await renameAnimationFolder(character, id, name);
      return projectContext.run({ ...projectContext.getStore()!, animationId: name }, async () => toView(await readManifest()));
    }
  }
  character.activeAnimationId = id;
  character.updatedAt = new Date().toISOString();
  await writeJson(spriteFile(PROJECT_FILES.manifest), character);
  return projectContext.run({ ...projectContext.getStore()!, animationId: id }, async () => toView(await readManifest()));
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
