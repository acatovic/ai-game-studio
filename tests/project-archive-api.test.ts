import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pngFixture } from './helpers/png.ts';

test('project ZIP export and import round trip validates structure and preserves existing projects', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-archive-test-'));
  const storage = path.join(root, 'storage');
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: '0', AI_GAME_STUDIO_HOME: storage, OPENROUTER_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  try {
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
      child.stdout.on('data', chunk => {
        const match = String(chunk).match(/http:\/\/localhost:(\d+)/);
        if (match) { clearTimeout(timer); resolve(`http://localhost:${match[1]}`); }
      });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${stderr}`)); });
    });
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) });
    const upload = (zip: Buffer, options: { renameTo?: string; replace?: boolean } = {}) => fetch(base + '/api/projects/import', {
      method: 'POST', headers: { 'Content-Type': 'application/zip',
        ...(options.renameTo ? { 'X-Import-Name': options.renameTo } : {}),
        ...(options.replace ? { 'X-Import-Mode': 'replace' } : {}) },
      body: new Uint8Array(zip),
    });
    assert.equal((await post('/api/projects/new', { name: 'export-game' })).status, 200);
    headers['X-Project-Name'] = 'export-game';
    const characterView = await (await post('/api/projects/sprites/new', { value: 'hero' })).json();
    headers['X-Sprite-Id'] = characterView.project.activeSpriteId;
    const spriteDir = path.join(storage, 'export-game/sprites/hero');
    const png = pngFixture(1, 1, [1, 2, 3, 255]);
    await writeFile(path.join(spriteDir, 'hero.png'), png);
    const character = JSON.parse(await readFile(path.join(spriteDir, 'sprite.json'), 'utf8'));
    await writeFile(path.join(spriteDir, 'sprite.json'), JSON.stringify({ ...character, sprite: 'hero.png', spriteDimensions: { w: 1, h: 1 } }));
    const animationView = await (await post('/api/projects/animations/new', { value: 'walk' })).json();
    headers['X-Animation-Id'] = animationView.activeAnimationId;
    const frames = path.join(spriteDir, 'animations/walk/frames');
    await mkdir(frames);
    await writeFile(path.join(frames, 'frame-00001.png'), png);
    const animationFile = path.join(spriteDir, 'animations/walk/animation.json');
    const animation = JSON.parse(await readFile(animationFile, 'utf8'));
    await writeFile(animationFile, JSON.stringify({ ...animation,
      frames: ['animations/walk/frames/frame-00001.png'], selectedFrameIndices: [0] }));
    const soundView = await (await post('/api/music/new', { value: 'laser' })).json();
    assert.equal(soundView.track.id, 'laser');
    const exported = await fetch(base + '/api/projects/export/export-game');
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition') ?? '', /export-game\.zip/);
    const zip = Buffer.from(await exported.arrayBuffer());
    assert.ok(zip.length > 100);
    const duplicate = await upload(zip);
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), {
      error: "A project named 'export-game' already exists", existingName: 'export-game',
    });
    assert.deepEqual(await readFile(path.join(frames, 'frame-00001.png')), png);
    assert.equal((await upload(zip, { renameTo: '../escape' })).status, 400);
    const renamed = await upload(zip, { renameTo: 'export-game-copy' });
    assert.equal(renamed.status, 200);
    assert.deepEqual(await renamed.json(), { name: 'export-game-copy' });
    assert.equal(JSON.parse(await readFile(path.join(storage, 'export-game-copy/.project'), 'utf8')).name, 'export-game-copy');
    assert.equal(JSON.parse(await readFile(path.join(storage, 'export-game-copy/sprites/hero/sprite.json'), 'utf8')).name, 'export-game-copy');
    assert.deepEqual(await readFile(path.join(storage, 'export-game-copy/sprites/hero/animations/walk/frames/frame-00001.png')), png);
    assert.equal((await upload(zip, { renameTo: 'export-game-copy' })).status, 409);
    const openedCopy = await (await post('/api/projects/load', { name: 'export-game-copy' })).json();
    assert.equal(openedCopy.name, 'export-game-copy');
    assert.equal(openedCopy.activeAnimationId, 'walk');
    const oldOnly = path.join(storage, 'export-game/old-only.txt');
    await writeFile(oldOnly, 'old project content');
    await writeFile(path.join(spriteDir, 'hero.png'), 'changed original');
    assert.equal((await upload(Buffer.from('not a zip'), { replace: true })).status, 400);
    assert.equal(await readFile(oldOnly, 'utf8'), 'old project content');
    const replaced = await upload(zip, { replace: true });
    assert.equal(replaced.status, 200);
    assert.deepEqual(await replaced.json(), { name: 'export-game' });
    assert.deepEqual(await readFile(path.join(spriteDir, 'hero.png')), png);
    await assert.rejects(readFile(oldOnly), { code: 'ENOENT' });
    assert.deepEqual((await readdir(storage)).filter(name => name.startsWith('.import-')), []);
    assert.equal((await post('/api/projects/delete', { name: 'export-game' })).status, 200);
    const imported = await upload(zip);
    assert.equal(imported.status, 200);
    assert.deepEqual(await imported.json(), { name: 'export-game' });
    assert.deepEqual(await readFile(path.join(frames, 'frame-00001.png')), png);
    assert.equal((await fetch(base + '/api/projects')).status, 200);
    const reopened = await (await post('/api/projects/load', { name: 'export-game' })).json();
    assert.equal(reopened.activeAnimationId, 'walk');
    assert.equal(reopened.frames.length, 1);
    assert.equal(JSON.parse(await readFile(path.join(storage, 'export-game/music/laser/music.json'), 'utf8')).id, 'laser');
    assert.equal((await upload(Buffer.from('not a zip'))).status, 400);
    assert.deepEqual((await readdir(storage)).filter(name => name.startsWith('.import-')), []);

    const replaceArchiveName = (original: string, replacement: string) => {
      const bad = Buffer.from(zip);
      const from = Buffer.from(original);
      const to = Buffer.from(replacement);
      assert.equal(from.length, to.length);
      let changes = 0;
      for (let i = 0; i <= bad.length - from.length; i++) {
        if (bad.subarray(i, i + from.length).equals(from)) { to.copy(bad, i); changes++; }
      }
      assert.ok(changes > 0);
      return bad;
    };
    let failed = await upload(replaceArchiveName('export-game/.project', 'export-game/..roject'));
    assert.equal(failed.status, 400);
    failed = await upload(replaceArchiveName('export-game/sprites/hero/', 'export-game/sprites/../a/'));
    assert.equal(failed.status, 400);
    failed = await upload(replaceArchiveName('frame-00001.png', 'frame-00002.png'));
    assert.equal(failed.status, 400);
    assert.match((await failed.json()).error, /referenced asset is missing/);
    assert.deepEqual(await readFile(path.join(frames, 'frame-00001.png')), png);
  } finally {
    child.kill();
    await rm(root, { recursive: true, force: true });
  }
});
