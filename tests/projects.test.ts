import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pngFixture } from './helpers/png.ts';

test('named character and animation directories, renames, empty projects, and legacy migration', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-names-'));
  process.env.AI_GAME_STUDIO_HOME = path.join(root, 'storage');
  const p = await import('../server/projects.js');
  const f = await import('../server/files.js');
  const storage = await import('../server/storage.js');
  const within = <T>(spriteId: string, animationId: string | undefined, fn: () => Promise<T>, name = 'game') =>
    f.projectContext.run({ name, spriteId, animationId }, fn);
  const png = pngFixture(1, 1, [10, 20, 30, 128]);
  try {
    await storage.initializeStorage();
    await assert.rejects(p.readManifest(), /Open or create/);
    let view = await p.createProject('game');
    assert.equal(view.project.activeSpriteId, '');
    assert.deepEqual(view.project.sprites, []);
    assert.deepEqual(await readdir(path.join(storage.PROJECTS_DIR, 'game')), ['.project']);
    assert.deepEqual((await p.openProject('game')).project.sprites, []);
    assert.equal((await p.listSavedProjects()).length, 1);
    view = await within('', undefined, () => p.changeSprite('new', 'scientist-male'));
    assert.equal(view.project.activeSpriteId, 'scientist-male');
    assert.equal(view.project.sprites[0].path, 'sprites/scientist-male/sprite.json');
    assert.deepEqual(view.animations, []);
    assert.equal(view.activeAnimationId, '');
    await within('scientist-male', undefined, async () => {
      await writeFile(f.spriteFile('scientist-male.png'), png);
      await p.updateSprite({ sprite: 'scientist-male.png', spritePrompt: 'scientist', spriteModel: 'openai/gpt-image-2.5-sunburst' });
      view = await p.changeAnimation('new', 'idle');
    });
    assert.equal(view.activeAnimationId, 'idle');
    await within('scientist-male', 'idle', async () => {
      await mkdir(f.spriteFile('animations/idle/frames'));
      await writeFile(f.spriteFile('animations/idle/frames/frame-00001.png'), png);
      await writeFile(f.spriteFile('animations/idle/idle.png'), png);
      await writeFile(f.spriteFile('animations/idle/idle.aseprite'), 'aseprite data');
      await p.updateSprite({ motionPrompt: 'idle breathing', frames: ['animations/idle/frames/frame-00001.png'],
        selectedFrameIndices: [0], spritesheet: 'animations/idle/idle.png', aseprite: 'animations/idle/idle.aseprite', spritesheetFrameCount: 1 });
      await p.changeAnimation('new', 'walking');
    });
    // Another tab's active animation doesn't redirect the original tab.
    await within('scientist-male', 'idle', () => p.updateSprite({ motionPrompt: 'idle slowly' }));
    assert.equal((await within('scientist-male', 'walking', p.readManifest)).motionPrompt, '');
    assert.equal((await within('scientist-male', 'idle', p.readManifest)).motionPrompt, 'idle slowly');
    view = await within('scientist-male', 'idle', () => p.changeAnimation('rename', 'standing'));
    assert.equal(view.activeAnimationId, 'standing');
    assert.ok(view.frames[0].includes('/sprites/scientist-male/animations/standing/frames/'));
    assert.ok(view.asepriteUrl!.endsWith('/animations/standing/standing.aseprite'));
    await assert.rejects(stat(path.join(storage.PROJECTS_DIR, 'game/sprites/scientist-male/animations/idle')), { code: 'ENOENT' });
    await assert.rejects(within('scientist-male', 'idle', p.readManifest), /Animation not found/);
    await assert.rejects(within('scientist-male', 'standing', () => p.changeAnimation('rename', 'walking')), /already exists/);
    view = await within('scientist-male', 'standing', () => p.changeSprite('rename', 'researcher'));
    assert.equal(view.project.activeSpriteId, 'researcher');
    assert.ok(view.spriteUrl!.endsWith('/sprites/researcher/researcher.png'));
    assert.ok(view.frames[0].includes('/sprites/researcher/animations/standing/'));
    await assert.rejects(stat(path.join(storage.PROJECTS_DIR, 'game/sprites/scientist-male')), { code: 'ENOENT' });
    await assert.rejects(within('scientist-male', 'standing', p.readManifest), /Character not found/);
    assert.deepEqual(await readFile(path.join(storage.PROJECTS_DIR, 'game/sprites/researcher/researcher.png')), png);
    view = await p.openProject('game');
    assert.equal(view.activeAnimationId, 'standing');
    assert.equal(view.motionPrompt, 'idle slowly');
    assert.equal(view.spriteModel, 'openai/gpt-image-2.5-flare');
    await within('researcher', 'standing', () => p.changeSprite('new', 'enemy'));
    await assert.rejects(within('researcher', 'standing', () => p.changeSprite('rename', 'enemy')), /already exists/);
    await within('researcher', 'standing', async () => {
      await mkdir(path.join(storage.PROJECTS_DIR, 'game/sprites/untracked'));
      await assert.rejects(p.changeSprite('rename', 'untracked'), /folder.*exists/);
    });
    await assert.rejects(p.createProject('../escape'));
    await assert.rejects(p.createProject('game'));
    assert.throws(() => f.safeAssetId('../escape'));
    assert.throws(() => f.ensureInsideRoot(path.join(root, 'escape')), /outside/);

    // Previously saved version-2 characters: migrate every folder to its UI name.
    const legacyRoot = path.join(storage.PROJECTS_DIR, 'legacy');
    const legacyDir = path.join(legacyRoot, 'sprites/sprite-1');
    await mkdir(path.join(legacyDir, 'animations/animation-1/frames'), { recursive: true });
    await writeFile(path.join(legacyRoot, '.project'), JSON.stringify({ version: 1, name: 'legacy', activeSpriteId: 'sprite-1',
      sprites: [{ id: 'sprite-1', name: 'scientist-male', path: 'sprites/sprite-1/sprite.json' }] }));
    await writeFile(path.join(legacyDir, 'scientist-male.png'), png);
    await writeFile(path.join(legacyDir, 'sprite.json'), JSON.stringify({ version: 2, name: 'legacy', sprite: 'scientist-male.png',
      spritePrompt: 'legacy hero', spriteModel: 'openai/gpt-image-2', spriteDimensions: { w: 1, h: 1 },
      activeAnimationId: 'animation-1', animations: [{ id: 'animation-1', name: 'idle' }] }));
    await writeFile(path.join(legacyDir, 'animations/animation-1/frames/a.png'), png);
    await writeFile(path.join(legacyDir, 'animations/animation-1/idle.png'), png);
    await writeFile(path.join(legacyDir, 'animations/animation-1/idle.aseprite'), 'preserved aseprite');
    await writeFile(path.join(legacyDir, 'animations/animation-1/animation.json'), JSON.stringify({ id: 'animation-1', name: 'idle',
      motionPrompt: 'rest', motionModel: 'x-ai/grok-imagine-video', frames: ['animations/animation-1/frames/a.png'], selectedFrameIndices: [0],
      spritesheet: 'animations/animation-1/idle.png', aseprite: 'animations/animation-1/idle.aseprite', spritesheetFrameCount: 1, previewGif: null }));
    const migrated = await p.openProject('legacy');
    assert.equal(migrated.project.activeSpriteId, 'scientist-male');
    assert.equal(migrated.activeAnimationId, 'idle');
    assert.equal(migrated.motionPrompt, 'rest');
    assert.equal(migrated.frames[0], '/projects/legacy/sprites/scientist-male/animations/idle/frames/a.png');
    assert.equal(await readFile(path.join(legacyRoot, 'sprites/scientist-male/animations/idle/idle.aseprite'), 'utf8'), 'preserved aseprite');
    await assert.rejects(stat(legacyDir), { code: 'ENOENT' });
    assert.equal((await p.openProject('legacy')).asepriteUrl, migrated.asepriteUrl);

    // Older single-motion manifests still upgrade, then receive named directories.
    const oldDir = path.join(storage.PROJECTS_DIR, 'old/sprites/sprite-1');
    await mkdir(path.join(oldDir, 'ref'), { recursive: true });
    await writeFile(path.join(storage.PROJECTS_DIR, 'old/.project'), JSON.stringify({ version: 1, name: 'old', activeSpriteId: 'sprite-1',
      sprites: [{ id: 'sprite-1', name: 'scientist', path: 'sprites/sprite-1/sprite.json' }] }));
    await writeFile(path.join(oldDir, 'ref/sprite.png'), png);
    await writeFile(path.join(oldDir, 'spritesheet.png'), png);
    await writeFile(path.join(oldDir, 'sprite.json'), JSON.stringify({ spritePrompt: 'old scientist', sprite: 'ref/sprite.png', spritesheet: 'spritesheet.png', frames: [], selectedFrameIndices: [] }));
    const old = await p.openProject('old');
    assert.equal(old.project.activeSpriteId, 'scientist');
    assert.ok(old.asepriteUrl!.includes('/animations/scientist-animation/'));
    assert.deepEqual(await readFile(path.join(storage.PROJECTS_DIR, 'old/sprites/scientist/ref/sprite.png')), png);
    await p.deleteSavedProject('old');
  } finally { await rm(root, { recursive: true, force: true }); }
});
