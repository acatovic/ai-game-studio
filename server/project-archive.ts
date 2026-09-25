import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { PROJECTS_DIR, projectDir, safeAssetId, safeProjectName } from "./files.js";
import { readProjectDocument } from "./projects.js";

const MAX_ARCHIVE_BYTES = 4 * 1024 ** 3;
const MAX_EXTRACTED_BYTES = 12 * 1024 ** 3;
const MAX_ENTRIES = 100_000;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc >>> 0;
});

function invalid(reason: string): Error { return new Error(`Invalid project archive: ${reason}`); }

export class ProjectImportConflict extends Error {
  constructor(readonly existingName: string) {
    super(`A project named '${existingName}' already exists`);
  }
}

async function rejectLinks(dir: string): Promise<void> {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await rejectLinks(file);
    else if (!item.isFile()) throw new Error("Project contains a link or unsupported file type");
  }
}

export async function createProjectArchive(name: string): Promise<string> {
  safeProjectName(name);
  await readProjectDocument(name);
  await rejectLinks(projectDir(name));
  const file = path.join(os.tmpdir(), `ai-game-studio-${randomUUID()}.zip`);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("zip", ["-q", "-r", "-X", file, name], { cwd: PROJECTS_DIR, stdio: "ignore" });
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve() : reject(new Error("Could not create project archive")));
    });
    return file;
  } catch (error) {
    await rm(file, { force: true });
    throw error;
  }
}

export async function receiveProjectArchive(stream: Readable): Promise<string> {
  const file = path.join(os.tmpdir(), `ai-game-studio-upload-${randomUUID()}.zip`);
  let bytes = 0;
  try {
    await pipeline(stream, new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > MAX_ARCHIVE_BYTES ? invalid("zip file is too large") : null, chunk);
    } }), createWriteStream(file, { flags: "wx" }));
    if (!bytes) throw invalid("zip file is empty");
    return file;
  } catch (error) {
    await rm(file, { force: true });
    throw error;
  }
}

function openZip(file: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false,
    validateEntrySizes: true, strictFileNames: true }, (error, zip) => error ? reject(invalid("cannot read zip file")) : resolve(zip)));
}

function streamEntry(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)));
}

function archivePath(entry: Entry): { name: string; relative: string; directory: boolean } {
  const value = entry.fileName;
  const directory = value.endsWith("/");
  const parts = (directory ? value.slice(0, -1) : value).split("/");
  if (!parts.length || parts.some(part => !part || part === "." || part === ".." || part.includes("\\") || part.includes("\0")) || value.startsWith("/")) {
    throw invalid("unsafe entry path");
  }
  const name = safeProjectName(parts[0]);
  if (parts.length < 2 && !directory) throw invalid("files must be inside one project folder");
  const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
  if (mode && mode !== (directory ? 0o040000 : 0o100000)) throw invalid("links and special files are not allowed");
  if (entry.isEncrypted()) throw invalid("encrypted entries are not supported");
  return { name, relative: parts.slice(1).join("/"), directory };
}

async function extractZip(file: string, destination: string): Promise<string> {
  const zip = await openZip(file);
  const seen = new Set<string>();
  let name: string | undefined;
  let count = 0;
  let size = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const fail = (error: unknown) => {
        if (finished) return;
        finished = true;
        reject(error instanceof Error ? error : invalid("cannot read zip file"));
      };
      zip.once("error", fail);
      zip.once("end", () => { if (!finished) { finished = true; resolve(); } });
      zip.on("entry", (entry: Entry) => {
        void (async () => {
          const parsed = archivePath(entry);
          if (name && parsed.name !== name) throw invalid("archive must contain exactly one project");
          name = parsed.name;
          if (++count > MAX_ENTRIES) throw invalid("too many files");
          size += entry.uncompressedSize;
          if (size > MAX_EXTRACTED_BYTES) throw invalid("extracted project is too large");
          if (!parsed.relative) { zip.readEntry(); return; }
          if (seen.has(parsed.relative)) throw invalid("duplicate entry");
          seen.add(parsed.relative);
          const target = path.join(destination, parsed.relative);
          if (!target.startsWith(destination + path.sep)) throw invalid("unsafe entry path");
          if (parsed.directory) await mkdir(target, { recursive: true });
          else {
            await mkdir(path.dirname(target), { recursive: true });
            let written = 0;
            let crc = 0xffffffff;
            await pipeline(await streamEntry(zip, entry), new Transform({ transform(chunk: Buffer, _encoding, callback) {
              written += chunk.length;
              for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
              callback(written > entry.uncompressedSize ? invalid("entry size mismatch") : null, chunk);
            } }), createWriteStream(target, { flags: "wx" }));
            if (written !== entry.uncompressedSize) throw invalid("entry size mismatch");
            if (((crc ^ 0xffffffff) >>> 0) !== entry.crc32) throw invalid("entry checksum mismatch");
          }
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  } finally { zip.close(); }
  if (!name) throw invalid("archive has no project");
  return name;
}

async function requiredFile(root: string, relative: unknown, prefix: string): Promise<void> {
  if (typeof relative !== "string" || !relative || relative.startsWith("/") || relative.includes("\\")) throw invalid("invalid asset path");
  const parts = relative.split("/");
  if (parts.some(part => !part || part === "." || part === "..")) throw invalid("invalid asset path");
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.join(root, prefix) + path.sep)) throw invalid("asset is outside its folder");
  try {
    if (!(await stat(target)).isFile()) throw invalid("expected asset file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw invalid("a referenced asset is missing");
    throw error;
  }
}

async function jsonFile(file: string): Promise<Record<string, unknown>> {
  try {
    if ((await stat(file)).size > 8 * 1024 * 1024) throw invalid("manifest is too large");
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("invalid manifest");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) throw invalid("invalid manifest JSON");
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw invalid("a manifest is missing");
    throw error;
  }
}

async function validateProject(root: string, name: string): Promise<void> {
  const doc = await jsonFile(path.join(root, ".project"));
  if (doc.version !== 1 || doc.name !== name || !Array.isArray(doc.sprites)) throw invalid("invalid .project manifest");
  const sprites = doc.sprites as Record<string, unknown>[];
  const spriteIds = new Set<string>();
  for (const item of sprites) {
    if (!item || typeof item !== "object" || typeof item.id !== "string") throw invalid("invalid character entry");
    safeAssetId(item.id);
    if (spriteIds.has(item.id) || typeof item.name !== "string" || item.path !== `sprites/${item.id}/sprite.json`) throw invalid("invalid character entry");
    spriteIds.add(item.id);
    const folder = path.join(root, "sprites", item.id);
    const character = await jsonFile(path.join(folder, "sprite.json"));
    if (character.version !== 2 && character.version !== undefined) throw invalid("unsupported character manifest");
    if (character.version === 2 && character.name !== name) throw invalid("character belongs to another project");
    for (const key of ["sprite", "referenceImage"] as const) {
      const value = character[key];
      const asset = key === "referenceImage" && value && typeof value === "object" ? (value as Record<string, unknown>).path : value;
      if (asset != null) await requiredFile(folder, asset, ".");
    }
    if (character.referenceViews && typeof character.referenceViews === "object") {
      for (const asset of Object.values(character.referenceViews)) if (asset != null) await requiredFile(folder, asset, ".");
    }
    if (character.version !== 2) {
      if (typeof character.spritePrompt !== "string" || !Array.isArray(character.frames)) throw invalid("invalid legacy character manifest");
      for (const asset of character.frames) await requiredFile(folder, asset, ".");
      for (const key of ["spritesheet", "aseprite", "previewGif"] as const) {
        if (character[key] != null) await requiredFile(folder, character[key], ".");
      }
      continue;
    }
    if (!Array.isArray(character.animations)) throw invalid("invalid animation entries");
    const animationIds = new Set<string>();
    for (const entry of character.animations as Record<string, unknown>[]) {
      if (!entry || typeof entry.id !== "string") throw invalid("invalid animation entry");
      safeAssetId(entry.id);
      if (animationIds.has(entry.id) || typeof entry.name !== "string") throw invalid("invalid animation entry");
      animationIds.add(entry.id);
      const animation = await jsonFile(path.join(folder, "animations", entry.id, "animation.json"));
      if (animation.id !== entry.id || !Array.isArray(animation.frames) || !Array.isArray(animation.selectedFrameIndices)) throw invalid("invalid animation manifest");
      for (const asset of animation.frames) await requiredFile(folder, asset, `animations/${entry.id}`);
      for (const key of ["spritesheet", "aseprite", "previewGif"] as const) {
        if (animation[key] != null) await requiredFile(folder, animation[key], `animations/${entry.id}`);
      }
      for (const key of ["startImage", "endImage"] as const) {
        const value = animation[key];
        if (value != null) await requiredFile(folder, (value as Record<string, unknown>).path, `animations/${entry.id}`);
      }
      if ((animation.selectedFrameIndices as unknown[]).some(index => !Number.isInteger(index) || (index as number) < 0 || (index as number) >= (animation.frames as unknown[]).length)) throw invalid("invalid frame selection");
    }
    if (animationIds.size ? !animationIds.has(character.activeAnimationId as string) : character.activeAnimationId !== "") throw invalid("invalid active animation");
  }
  if (spriteIds.size ? !spriteIds.has(doc.activeSpriteId as string) : doc.activeSpriteId !== "") throw invalid("invalid active character");
  if (doc.music !== undefined) {
    if (!Array.isArray(doc.music)) throw invalid("invalid sound entries");
    const musicIds = new Set<string>();
    for (const entry of doc.music as Record<string, unknown>[]) {
      if (!entry || typeof entry.id !== "string") throw invalid("invalid sound entry");
      safeAssetId(entry.id);
      if (musicIds.has(entry.id) || entry.name !== entry.id || entry.path !== `music/${entry.id}/music.json`) throw invalid("invalid sound entry");
      musicIds.add(entry.id);
      const folder = path.join(root, "music", entry.id);
      const music = await jsonFile(path.join(folder, "music.json"));
      if (music.version !== 1 || music.id !== entry.id || music.name !== entry.id) throw invalid("invalid sound manifest");
      if (music.output) {
        if (typeof music.output !== "object") throw invalid("invalid sound output");
        for (const key of ["source", "audio"] as const) await requiredFile(folder, (music.output as Record<string, unknown>)[key], ".");
      }
    }
    if (musicIds.size ? !musicIds.has(doc.activeMusicId as string) : !!doc.activeMusicId) throw invalid("invalid active sound");
  }
}

async function rewriteProjectName(root: string, name: string): Promise<void> {
  const file = path.join(root, ".project");
  const doc = await jsonFile(file);
  await writeFile(file, JSON.stringify({ ...doc, name }, null, 2));
  for (const sprite of doc.sprites as { id: string }[]) {
    const manifest = path.join(root, "sprites", sprite.id, "sprite.json");
    const character = await jsonFile(manifest);
    if (character.version === 2 || character.name !== undefined) {
      await writeFile(manifest, JSON.stringify({ ...character, name }, null, 2));
    }
  }
}

export async function importProjectArchive(
  file: string,
  options: { renameTo?: string; replace?: boolean } = {},
): Promise<string> {
  if (options.renameTo) safeProjectName(options.renameTo);
  if (options.renameTo && options.replace) throw new Error("Choose either a new name or replace");
  await mkdir(PROJECTS_DIR, { recursive: true });
  const staging = await mkdtemp(path.join(PROJECTS_DIR, ".import-"));
  try {
    const originalName = await extractZip(file, staging);
    await validateProject(staging, originalName);
    const name = options.renameTo ?? originalName;
    const destination = projectDir(name);
    let existing: Awaited<ReturnType<typeof lstat>> | undefined;
    try { existing = await lstat(destination); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (existing && !options.replace) throw new ProjectImportConflict(name);
    if (name !== originalName) await rewriteProjectName(staging, name);
    if (existing) {
      if (!existing.isDirectory()) throw new Error("The existing project path is not a folder");
      await readProjectDocument(name);
      const backup = path.join(PROJECTS_DIR, `.import-backup-${randomUUID()}`);
      await rename(destination, backup);
      try {
        await rename(staging, destination);
      } catch (error) {
        await rename(backup, destination);
        throw error;
      }
      await rm(backup, { recursive: true, force: true }).catch(() => {});
    } else {
      await rename(staging, destination);
    }
    return name;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export async function removeArchive(file: string): Promise<void> { await rm(file, { force: true }); }
