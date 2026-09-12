import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { currentProjectName, ensureInsideRoot, projectDir, safeAssetId } from "./files.js";
import { readProjectDocument, writeProjectDocument, writeJson, type ProjectDocument } from "./projects.js";
import { DEFAULT_MUSIC_MODEL, validateMusicSettings, type MusicSettings } from "./music.js";
import { deleteAssetFolder } from "./asset-storage.js";

export interface MusicOutput extends MusicSettings {
  audio: string;
  source: string;
  crossfadeSeconds: number;
  actualDuration?: number;
  createdAt: string;
}
export interface MusicManifest extends MusicSettings {
  version: 1;
  id: string;
  name: string;
  output: MusicOutput | null;
  updatedAt: string;
}

export function musicFile(id: string, relative = ""): string {
  safeAssetId(id);
  const root = path.join(projectDir(currentProjectName()), "music", id);
  const file = path.resolve(root, relative);
  ensureInsideRoot(file);
  if (file !== root && !file.startsWith(root + path.sep)) throw new Error("Path outside music directory");
  return file;
}

export async function readMusic(id: string): Promise<MusicManifest> {
  const doc = await readProjectDocument(currentProjectName());
  if (!doc.music?.some(track => track.id === id)) throw new Error("Sound not found");
  const track = JSON.parse(await readFile(musicFile(id, "music.json"), "utf8")) as MusicManifest;
  if (track.version !== 1 || track.id !== id || track.name !== id) throw new Error("Invalid sound manifest");
  // Adapt legacy Lyria draft settings; retain original output metadata and files.
  if (track.model === "google/lyria-3-pro-preview") {
    track.model = DEFAULT_MUSIC_MODEL;
    track.duration = typeof track.duration === "number" && track.duration >= 0.5 && track.duration <= 30 ? track.duration : null;
  }
  validateMusicSettings(track, true);
  if (track.output) {
    musicFile(id, track.output.audio);
    musicFile(id, track.output.source);
  }
  return track;
}

export async function musicView(id?: string) {
  const doc = await readProjectDocument(currentProjectName());
  const activeId = id ?? doc.activeMusicId ?? "";
  const track = activeId ? await readMusic(activeId) : null;
  return toMusicView(doc, activeId, track);
}

function toMusicView(doc: ProjectDocument, activeId: string, track: MusicManifest | null) {
  const base = `/projects/${encodeURIComponent(doc.name)}/music/${encodeURIComponent(activeId)}/`;
  return {
    tracks: doc.music ?? [], activeMusicId: activeId,
    track: track ? { ...track, audioUrl: track.output ? base + track.output.audio : null } : null,
  };
}

export async function saveMusicDraft(id: string, value: unknown) {
  const current = await readMusic(id);
  const settings = validateMusicSettings(value, true);
  const track = { ...current, ...settings, updatedAt: new Date().toISOString() };
  const doc = await readProjectDocument(currentProjectName());
  await writeProjectDocument(doc);
  await writeJson(musicFile(id, "music.json"), track);
  return toMusicView(doc, id, track);
}

export async function commitMusicOutput(id: string, output: MusicOutput) {
  const current = await readMusic(id);
  const settings = validateMusicSettings(output);
  musicFile(id, output.audio);
  musicFile(id, output.source);
  const track: MusicManifest = {
    ...current, ...settings, output, updatedAt: new Date().toISOString(),
  };
  const doc = await readProjectDocument(currentProjectName());
  await writeProjectDocument(doc);
  // The atomic manifest replacement is the final fallible operation. Once it
  // succeeds, the route must never clean up this now-committed revision.
  await writeJson(musicFile(id, "music.json"), track);
  return toMusicView(doc, id, track);
}

export async function changeMusic(action: "new" | "load" | "rename", value: string, id?: string) {
  safeAssetId(value);
  const doc = await readProjectDocument(currentProjectName());
  doc.music ??= [];
  if (action === "load") {
    await readMusic(value);
    doc.activeMusicId = value;
    await writeProjectDocument(doc);
    return musicView(value);
  }
  if (doc.music.some(track => track.id.toLowerCase() === value.toLowerCase())) {
    if (action === "rename" && value === id) return musicView(id);
    throw new Error("A sound with that name already exists");
  }
  if (action === "new") {
    await mkdir(path.dirname(musicFile(value)), { recursive: true });
    await mkdir(musicFile(value));
    const track: MusicManifest = {
      version: 1, id: value, name: value, prompt: "", model: DEFAULT_MUSIC_MODEL,
      duration: null, loop: false, output: null, updatedAt: new Date().toISOString(),
    };
    try {
      await writeJson(musicFile(value, "music.json"), track);
      doc.music.push({ id: value, name: value, path: `music/${value}/music.json` });
      doc.activeMusicId = value;
      await writeProjectDocument(doc);
    } catch (error) {
      await rm(musicFile(value), { recursive: true, force: true });
      throw error;
    }
  } else {
    if (!id) throw new Error("Select a sound first");
    const current = await readMusic(id);
    // Reserve the destination so an unrelated folder is never overwritten.
    const destination = musicFile(value);
    await mkdir(destination);
    const moved: { from: string; to: string }[] = [];
    const track = structuredClone(current);
    track.id = value; track.name = value; track.updatedAt = new Date().toISOString();
    try {
      await rename(musicFile(id), destination);
      if (track.output) {
        const previous = track.output.audio;
        const next = path.posix.join(path.posix.dirname(previous), `${value}.wav`);
        await rename(musicFile(value, previous), musicFile(value, next));
        moved.push({ from: previous, to: next });
        track.output.audio = next;
      }
      await writeJson(musicFile(value, "music.json"), track);
      doc.music = doc.music.map(entry => entry.id === id
        ? { id: value, name: value, path: `music/${value}/music.json` } : entry);
      doc.activeMusicId = value;
      await writeProjectDocument(doc);
    } catch (error) {
      for (const move of moved.reverse()) await rename(musicFile(value, move.to), musicFile(value, move.from));
      // Only move back when the source was successfully moved into the reserved destination.
      const manifest = path.join(destination, "music.json");
      try {
        await readFile(manifest);
        await writeJson(manifest, current);
        await rename(destination, musicFile(id));
      } catch (rollbackError) {
        if ((rollbackError as NodeJS.ErrnoException).code !== "ENOENT") throw rollbackError;
        await rm(destination, { recursive: true, force: true });
      }
      throw error;
    }
  }
  return musicView(value);
}

export async function deleteMusic(id: string) {
  safeAssetId(id);
  const doc = await readProjectDocument(currentProjectName());
  const index = doc.music?.findIndex(track => track.id === id) ?? -1;
  if (index < 0) throw new Error("Sound not found");
  doc.music!.splice(index, 1);
  if (doc.activeMusicId === id) {
    doc.activeMusicId = doc.music![Math.min(index, doc.music!.length - 1)]?.id ?? "";
  }
  await deleteAssetFolder(musicFile(id), () => writeProjectDocument(doc));
  return musicView();
}

export function newMusicRevision(id: string): string {
  // Every generation retains its own source and never overwrites a committed WAV.
  const revision = `revisions/${randomUUID()}`;
  musicFile(id, revision);
  return revision;
}
