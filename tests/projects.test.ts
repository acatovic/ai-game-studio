import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('projects edit in place, isolate sprites and persist across reopening', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-projects-'));
  process.env.AI_GAME_STUDIO_HOME = path.join(root, 'storage');
  const p = await import('../server/projects.js');
  const f = await import('../server/files.js');
  const storage = await import('../server/storage.js');
  const inSprite = <T>(name: string, spriteId: string, fn: () => Promise<T>) => f.projectContext.run({ name, spriteId }, fn);
  try {
    await storage.initializeStorage();
    await storage.initializeStorage();
    assert.deepEqual(await p.listSavedProjects(), []);
    await assert.rejects(p.readManifest(), /Open or create/);
    let view = await p.createProject('game');
    assert.equal(view.name, 'game');
    const first = view.project.activeSpriteId;
    await inSprite('game', first, async () => {
      await p.updateSprite({ spritePrompt: 'hero', frames: ['frames/a.png'], selectedFrameIndices: [0] });
      await mkdir(path.join(f.activeSpriteDir(), 'frames'), { recursive: true });
      await writeFile(path.join(f.activeSpriteDir(), 'frames/a.png'), 'hero pixels');
      view = await p.changeSprite('new', 'Enemy');
    });
    const second = view.project.activeSpriteId;
    assert.equal(view.spritePrompt, '');
    assert.equal(view.project.sprites.length, 2);
    await inSprite('game', second, () => p.updateSprite({ spritePrompt: 'enemy' }));
    view = await inSprite('game', second, () => p.changeSprite('load', first));
    assert.equal(view.spritePrompt, 'hero');
    assert.equal(view.frames[0], '/projects/game/sprites/sprite-1/frames/a.png');
    assert.deepEqual(view.selectedFrameIndices, [0]);
    await inSprite('game', first, () => p.changeSprite('rename', 'Hero'));
    await p.createProject('other');
    view = await p.openProject('game');
    assert.equal(view.project.sprites[0].name, 'Hero');
    assert.equal(view.spritePrompt, 'hero');
    // A different tab's active sprite does not redirect the first tab's writes.
    await inSprite('game', first, () => p.changeSprite('load', second));
    await inSprite('game', first, () => p.updateSprite({ motionPrompt: 'walk' }));
    assert.equal((await inSprite('game', second, p.readManifest)).motionPrompt, '');
    assert.equal((await inSprite('game', first, p.readManifest)).motionPrompt, 'walk');
    assert.equal(await readFile(path.join(storage.PROJECTS_DIR, 'game/sprites/sprite-1/frames/a.png'), 'utf8'), 'hero pixels');
    await assert.rejects(inSprite('game', first, () => p.changeSprite('load', '../game')));
    await assert.rejects(p.createProject('game'));
    await assert.rejects(p.createProject('../escape'));
    assert.throws(() => f.ensureInsideRoot(path.join(root, 'escape')), /outside/);
    assert.deepEqual((await readdir(storage.PROJECTS_DIR)).sort(), ['game', 'other']);
    assert.deepEqual((await readdir(path.join(storage.PROJECTS_DIR, 'game'))).sort(), ['.project', 'sprites']);
    const doc = JSON.parse(await readFile(path.join(storage.PROJECTS_DIR, 'game/.project'), 'utf8'));
    assert.equal(doc.version, 1);
    assert.equal(doc.name, 'game');
    await p.deleteSavedProject('other');
    assert.equal((await p.listSavedProjects()).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
