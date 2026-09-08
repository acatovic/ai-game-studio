import { mkdir, readFile, readdir, rm, writeFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PROJECTS_DIR, PROJECT_FILES, projectDir, safeProjectName, activeSpriteDir,
  currentProjectName, projectContext, ensureInsideRoot } from "./files.js";

export interface ProjectDocument {
  version: 1;
  name: string;
  activeSpriteId: string;
  sprites: { id: string; name: string; path: string }[];
}

export interface ProjectManifest {
  project?: ProjectDocument;
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
  previewGif: string | null;
  updatedAt: string;
}

export interface ProjectView {
  project: ProjectDocument;
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
  previewGifUrl: string | null;
  updatedAt: string;
}

export function emptyManifest(name: string): ProjectManifest {
  return {
    name,
    spritePrompt: "",
    spriteModel: "openai/gpt-image-2",
    motionPrompt: "",
    motionModel: "x-ai/grok-imagine-video",
    sprite: null,
    spriteDimensions: null,
    frames: [],
    selectedFrameIndices: [],
    spritesheet: null,
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
  if (doc.version !== 1 || doc.name !== name || !Array.isArray(doc.sprites) || !doc.sprites.length ||
      !doc.sprites.some(s => s.id === doc.activeSpriteId)) throw new Error("Invalid .project manifest");
  for (const sprite of doc.sprites) {
    safeProjectName(sprite.id);
    if (typeof sprite.name !== "string" || sprite.path !== `sprites/${sprite.id}/sprite.json`) throw new Error("Invalid sprite entry");
  }
  return doc;
}

async function writeProjectDocument(doc: ProjectDocument): Promise<void> {
  await writeJson(path.join(projectDir(doc.name), ".project"), doc);
}

export async function readManifest(): Promise<ProjectManifest> {
  const doc = await readProjectDocument(currentProjectName());
  const id = projectContext.getStore()!.spriteId;
  if (!doc.sprites.some(s => s.id === id)) throw new Error("Sprite not found");
  const parsed = JSON.parse(await readFile(path.join(activeSpriteDir(), PROJECT_FILES.manifest), "utf8"));
  return { ...emptyManifest(doc.name), ...parsed, project: { ...doc, activeSpriteId: id } };
}

export async function updateSprite(patch: Partial<ProjectManifest>): Promise<ProjectManifest> {
  const current = await readManifest();
  const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
  const { project: _project, ...sprite } = updated;
  await writeJson(path.join(activeSpriteDir(), PROJECT_FILES.manifest), sprite);
  await writeProjectDocument(updated.project!);
  return updated;
}

export function toView(m: ProjectManifest): ProjectView {
  const doc = m.project!;
  const base = `/projects/${encodeURIComponent(doc.name)}/sprites/${encodeURIComponent(doc.activeSpriteId)}/`;
  return { project: doc, name: doc.name, spritePrompt: m.spritePrompt, spriteModel: m.spriteModel,
    motionPrompt: m.motionPrompt, motionModel: m.motionModel,
    spriteUrl: m.sprite ? base + m.sprite : null, spriteDimensions: m.spriteDimensions,
    frames: m.frames.map(f => base + f), selectedFrameIndices: m.selectedFrameIndices,
    spritesheetUrl: m.spritesheet ? base + m.spritesheet : null,
    previewGifUrl: m.previewGif ? base + m.previewGif : null, updatedAt: m.updatedAt };
}

export async function wipeFramesAndSheet(): Promise<void> {
  await rm(path.join(activeSpriteDir(), PROJECT_FILES.framesDir), { recursive: true, force: true });
  await rm(path.join(activeSpriteDir(), PROJECT_FILES.source), { force: true });
  await wipeSpritesheet();
}
export async function wipeSpritesheet(): Promise<void> {
  for (const file of [PROJECT_FILES.spritesheet, PROJECT_FILES.previewGif]) {
    await rm(path.join(activeSpriteDir(), file), { force: true });
  }
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
  const doc = await readProjectDocument(name);
  return projectContext.run({ name, spriteId: doc.activeSpriteId }, async () => toView(await readManifest()));
}

export async function deleteSavedProject(name: string): Promise<void> {
  await readProjectDocument(name);
  await rm(projectDir(name), { recursive: true });
}

export async function changeSprite(action: "new" | "load" | "rename", value: string): Promise<ProjectView> {
  const doc = await readProjectDocument(currentProjectName());
  doc.activeSpriteId = projectContext.getStore()!.spriteId;
  if (action === "load" && !doc.sprites.some(s => s.id === value)) throw new Error("Sprite not found");
  if (action !== "load" && (!value.trim() || value.length > 60)) throw new Error("Sprite name must be 1–60 characters");
  if (action === "new") {
    const id = `sprite-${randomUUID().slice(0, 24)}`;
    doc.sprites.push({ id, name: value.trim(), path: `sprites/${id}/sprite.json` });
    doc.activeSpriteId = id;
    await writeJson(path.join(projectDir(doc.name), "sprites", id, "sprite.json"), emptyManifest(doc.name));
  } else if (action === "load") doc.activeSpriteId = value;
  else doc.sprites.find(s => s.id === doc.activeSpriteId)!.name = value.trim();
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
  const doc: ProjectDocument = { version: 1, name, activeSpriteId: "sprite-1",
    sprites: [{ id: "sprite-1", name: "Sprite 1", path: "sprites/sprite-1/sprite.json" }] };
  await writeJson(path.join(projectDir(name), "sprites/sprite-1/sprite.json"), emptyManifest(name));
  await writeProjectDocument(doc);
  return openProject(name);
}
