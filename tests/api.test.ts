import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { pngFixture } from './helpers/png.ts';

test('API requires explicit project context and serves assets from project storage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-api-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: '0', AI_GAME_STUDIO_HOME: root, OPENROUTER_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += String(chunk); });
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
    const videoModels = await (await fetch(base + '/api/models/video')).json();
    assert.ok(videoModels.models.some((model: { id: string; label: string; defaultDuration: number }) =>
      model.id === 'minimax/hailuo-3-max' && model.label === 'MiniMax H3 Max' && model.defaultDuration === 5));
    const frameLimits = new Map(videoModels.models.map((model: { id: string; supportsEndImage: boolean; maxKeyframeImages: number }) =>
      [model.id, { end: model.supportsEndImage, max: model.maxKeyframeImages }]));
    assert.deepEqual(frameLimits.get('minimax/hailuo-3-max'), { end: false, max: 1 });
    assert.deepEqual(frameLimits.get('minimax/hailuo-3'), { end: true, max: 2 });
    assert.equal((await post('/api/projects/draft', {})).status, 400);
    let response = await post('/api/projects/new', { name: 'demo' });
    assert.equal(response.status, 200);
    const view = await response.json();
    assert.deepEqual(view.project.sprites, []);
    headers = { ...headers, 'X-Project-Name': view.name };
    assert.equal((await post('/api/projects/save', {})).status, 200);
    response = await post('/api/projects/sprites/new', { value: 'hero' });
    const first = await response.json();
    assert.equal(first.project.activeSpriteId, 'hero');
    assert.deepEqual(first.animations, []);
    headers['X-Sprite-Id'] = first.project.activeSpriteId;
    response = await post('/api/projects/draft', { spritePrompt: 'hero', motionPrompt: '', spriteModel: 'openai/gpt-image-2', motionModel: 'x-ai/grok-imagine-video' });
    assert.equal(response.status, 200);
    const longDraft = { spritePrompt: 'a'.repeat(20_000), motionPrompt: 'b'.repeat(3_000),
      spriteModel: 'openai/gpt-image-2', motionModel: 'x-ai/grok-imagine-video' };
    response = await post('/api/projects/draft', longDraft);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).spritePrompt, longDraft.spritePrompt);
    response = await post('/api/projects/draft', { ...longDraft, spritePrompt: 'a'.repeat(20_001) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /Character prompt.*20,000.*20,001/);
    response = await post('/api/projects/draft', { ...longDraft, spritePrompt: 'hero' });
    assert.equal(response.status, 200);
    response = await fetch(base + '/projects/demo/sprites/hero/sprite.json');
    assert.equal((await response.json()).spritePrompt, 'hero');
    response = await post('/api/projects/sprites/new', { value: 'Enemy' });
    assert.equal((await response.json()).spritePrompt, '');
    // Requests from the original tab still update the original sprite.
    response = await post('/api/projects/draft', { spritePrompt: 'hero revised', motionPrompt: '', spriteModel: 'openai/gpt-image-2', motionModel: 'x-ai/grok-imagine-video' });
    assert.equal((await response.json()).spritePrompt, 'hero revised');
    // One character reference is shared by independent named animation assets.
    response = await post('/api/projects/sprites/rename', { value: 'scientist' });
    let current = await response.json();
    assert.equal(current.project.activeSpriteId, 'scientist');
    headers['X-Sprite-Id'] = current.project.activeSpriteId;
    const characterDir = path.join(root, 'demo/sprites/scientist');
    const characterFile = path.join(characterDir, 'sprite.json');
    const character = JSON.parse(await readFile(characterFile, 'utf8'));
    const framePng = pngFixture(1, 1, [255, 0, 0, 128]);
    await writeFile(path.join(characterDir, 'scientist.png'), framePng);
    await writeFile(characterFile, JSON.stringify({ ...character, sprite: 'scientist.png', spriteDimensions: { w: 1, h: 1 } }));
    response = await post('/api/projects/animations/new', { value: 'walking' });
    current = await response.json();
    const walkingId = current.activeAnimationId;
    headers['X-Animation-Id'] = walkingId;
    const animationDir = path.join(characterDir, 'animations', walkingId);
    const animationFile = path.join(animationDir, 'animation.json');
    const animation = JSON.parse(await readFile(animationFile, 'utf8'));
    await mkdir(path.join(animationDir, 'frames'), { recursive: true });
    await writeFile(path.join(animationDir, 'frames/frame-00001.png'), framePng);
    await writeFile(animationFile, JSON.stringify({ ...animation, frames: [`animations/${walkingId}/frames/frame-00001.png`] }));
    assert.equal((await post('/api/projects/selection', { selectedIndices: [0] })).status, 200);
    response = await post('/api/projects/spritesheet', { dataUrl: `data:image/png;base64,${framePng.toString('base64')}` });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.ok(saved.spritesheetUrl.endsWith('/walking.png'));
    assert.ok(saved.asepriteUrl.endsWith('/walking.aseprite'));
    assert.equal(saved.spritesheetFrameCount, 1);
    const ase = Buffer.from(await (await fetch(base + saved.asepriteUrl)).arrayBuffer());
    assert.equal(ase.readUInt16LE(4), 0xa5e0);
    assert.equal(ase.readUInt16LE(6), 1);
    assert.deepEqual(Buffer.from(await (await fetch(base + saved.spritesheetUrl)).arrayBuffer()), framePng);
    // Rejected updates preserve the last complete pair.
    assert.equal((await post('/api/projects/spritesheet', { dataUrl: 'data:image/png;base64,AAAA' })).status, 400);
    assert.equal((await post('/api/projects/selection', { selectedIndices: [-1] })).status, 400);
    response = await post('/api/projects/animations/new', { value: 'idle' });
    const idle = await response.json();
    assert.equal(idle.spriteUrl, saved.spriteUrl);
    assert.deepEqual(idle.frames, []);
    assert.equal(idle.asepriteUrl, null);
    assert.equal(idle.animations.length, 2);
    // The first tab's animation header still targets walking after a second tab switches to idle.
    response = await post('/api/projects/draft', { spritePrompt: 'hero revised', motionPrompt: 'walk left', spriteModel: 'openai/gpt-image-2', motionModel: 'minimax/hailuo-3-max' });
    assert.equal((await response.json()).activeAnimationId, walkingId);
    headers['X-Animation-Id'] = idle.activeAnimationId;
    response = await fetch(base + '/api/projects/current', { headers });
    assert.equal((await response.json()).motionPrompt, '');
    assert.equal((await post('/api/projects/animations/new', { value: 'walking' })).status, 400);
    response = await post('/api/projects/animations/load', { value: walkingId });
    assert.equal((await response.json()).asepriteUrl, saved.asepriteUrl);
    headers['X-Animation-Id'] = walkingId;
    response = await post('/api/projects/animations/rename', { value: 'running' });
    const renamed = await response.json();
    assert.equal(renamed.activeAnimationId, 'running');
    headers['X-Animation-Id'] = renamed.activeAnimationId;
    assert.ok(renamed.spritesheetUrl.endsWith('/running.png'));
    assert.ok(renamed.asepriteUrl.endsWith('/running.aseprite'));
    assert.equal((await fetch(base + renamed.asepriteUrl)).status, 200);
    response = await post('/api/projects/sprites/rename', { value: 'researcher' });
    current = await response.json();
    assert.ok(current.spriteUrl.endsWith('/researcher.png'));
    assert.equal(current.asepriteUrl, renamed.asepriteUrl.replace('/sprites/scientist/', '/sprites/researcher/'));
    assert.equal((await fetch(base + current.spriteUrl)).status, 200);
    response = await post('/api/projects/load', { name: 'demo' });
    current = await response.json();
    assert.equal(current.activeAnimationId, 'running');
    assert.equal(current.motionPrompt, 'walk left');
    assert.equal(current.motionModel, 'minimax/hailuo-3-max');
    assert.equal(current.asepriteUrl, renamed.asepriteUrl.replace('/sprites/scientist/', '/sprites/researcher/'));
    headers['X-Sprite-Id'] = 'researcher';
    response = await post('/api/projects/animations/duplicate', { value: 'running-2' });
    assert.equal(response.status, 200);
    const duplicate = await response.json();
    assert.equal(duplicate.activeAnimationId, 'running-2');
    assert.equal(duplicate.motionPrompt, current.motionPrompt);
    assert.equal(duplicate.motionModel, current.motionModel);
    assert.deepEqual(duplicate.selectedFrameIndices, current.selectedFrameIndices);
    assert.ok(duplicate.spritesheetUrl.endsWith('/running-2.png'));
    assert.ok(duplicate.asepriteUrl.endsWith('/running-2.aseprite'));
    assert.deepEqual(Buffer.from(await (await fetch(base + duplicate.asepriteUrl)).arrayBuffer()), ase);
    assert.equal((await post('/api/projects/animations/duplicate', { value: 'running-2' })).status, 400);
    // Original scoped requests still access the original after duplication selects the copy.
    const original = await (await fetch(base + '/api/projects/current', { headers })).json();
    assert.equal(original.activeAnimationId, 'running');
    assert.equal(original.asepriteUrl, current.asepriteUrl);
    assert.equal((await (await post('/api/projects/load', { name: 'demo' })).json()).activeAnimationId, 'running-2');
    delete headers['X-Animation-Id'];
    assert.equal((await post('/api/projects/animations/duplicate', { value: 'ambiguous' })).status, 400);
    assert.equal((await post('/api/projects/animations/delete', {})).status, 400);
    headers['X-Animation-Id'] = 'missing';
    assert.equal((await post('/api/projects/animations/delete', {})).status, 400);
    // Deleting the original in an older tab preserves the currently active duplicate.
    headers['X-Animation-Id'] = 'running';
    response = await post('/api/projects/animations/delete', {});
    assert.equal(response.status, 200);
    const afterDelete = await response.json();
    assert.equal(afterDelete.activeAnimationId, 'running-2');
    assert.deepEqual(afterDelete.animations.map((animation: { id: string }) => animation.id), ['idle', 'running-2']);
    assert.equal((await fetch(base + current.asepriteUrl)).status, 404);
    assert.deepEqual(Buffer.from(await (await fetch(base + duplicate.asepriteUrl)).arrayBuffer()), ase);
    assert.equal((await post('/api/projects/animations/delete', {})).status, 400, 'stale deletion must not remove the next animation');
    assert.equal((await post('/api/projects/draft', longDraft)).status, 400, 'stale saves must not recreate deleted animations');
    headers['X-Animation-Id'] = 'running-2';
    response = await post('/api/projects/animations/delete', {});
    assert.equal((await response.json()).activeAnimationId, 'idle');
    headers['X-Animation-Id'] = 'idle';
    response = await post('/api/projects/animations/delete', {});
    assert.equal(response.status, 200);
    const empty = await response.json();
    assert.deepEqual(empty.animations, []);
    assert.equal(empty.activeAnimationId, '');
    assert.deepEqual(empty.frames, []);
    assert.equal(empty.spritesheetUrl, null);
    assert.equal((await fetch(base + empty.spriteUrl)).status, 200, 'character reference survives deletion');
    assert.deepEqual(await readdir(path.join(root, 'demo/sprites/researcher/animations')), []);
    assert.deepEqual((await (await post('/api/projects/load', { name: 'demo' })).json()).animations, []);
    delete headers['X-Animation-Id'];
    assert.equal((await post('/api/projects/animations/new', { value: 'idle' })).status, 200);
    assert.deepEqual(await readdir(root), ['demo']);
    assert.equal((await post('/api/projects/new', { name: '../escape' })).status, 400);

    // Character deletion removes all revisions and nested assets while preserving other project assets.
    response = await post('/api/music/new', { value: 'rain' });
    assert.equal(response.status, 200);
    const soundFile = path.join(root, 'demo/music/rain/music.json');
    const soundBefore = await readFile(soundFile, 'utf8');
    const researcherDir = path.join(root, 'demo/sprites/researcher');
    await mkdir(path.join(researcherDir, 'references/old-revision'), { recursive: true });
    await writeFile(path.join(researcherDir, 'references/old-revision/side-original.png'), framePng);
    await mkdir(path.join(researcherDir, 'inputs/upload'), { recursive: true });
    await writeFile(path.join(researcherDir, 'inputs/upload/reference.png'), framePng);
    await writeFile(path.join(researcherDir, 'animations/idle/source.mp4'), 'source video');
    assert.equal((await post('/api/projects/sprites/new', { value: 'Sidekick' })).status, 200);
    headers['X-Sprite-Id'] = 'Sidekick';
    response = await post('/api/projects/animations/new', { value: 'wave' });
    assert.equal(response.status, 200);
    const sidekickFile = path.join(root, 'demo/sprites/Sidekick/sprite.json');
    const sidekickBefore = await readFile(sidekickFile, 'utf8');
    const projectFile = path.join(root, 'demo/.project');
    const projectBefore = await readFile(projectFile, 'utf8');
    delete headers['X-Sprite-Id'];
    assert.equal((await post('/api/projects/sprites/delete', {})).status, 400);
    for (const id of ['missing', '../Sidekick']) {
      headers['X-Sprite-Id'] = id;
      assert.equal((await post('/api/projects/sprites/delete', {})).status, 400);
    }
    assert.equal(await readFile(projectFile, 'utf8'), projectBefore);
    // An older tab deletes its own character, even after another tab selects Sidekick.
    headers['X-Sprite-Id'] = 'researcher';
    headers['X-Animation-Id'] = 'idle';
    response = await post('/api/projects/sprites/delete', {});
    assert.equal(response.status, 200);
    const afterCharacterDelete = await response.json();
    assert.equal(afterCharacterDelete.project.activeSpriteId, 'Sidekick');
    assert.equal(afterCharacterDelete.activeAnimationId, 'wave', 'discard the deleted character’s animation context');
    assert.deepEqual(afterCharacterDelete.project.sprites.map((sprite: { id: string }) => sprite.id), ['Enemy', 'Sidekick']);
    assert.equal((await fetch(base + empty.spriteUrl)).status, 404);
    assert.deepEqual((await readdir(path.join(root, 'demo/sprites'))).sort(), ['Enemy', 'Sidekick'],
      'the entire character directory and staged deletion folder are removed');
    assert.equal(await readFile(sidekickFile, 'utf8'), sidekickBefore);
    assert.equal(await readFile(soundFile, 'utf8'), soundBefore);
    assert.equal((await post('/api/projects/sprites/delete', {})).status, 400, 'stale deletion cannot remove the next character');
    assert.equal((await post('/api/projects/draft', longDraft)).status, 400, 'stale saves cannot recreate the deleted character');
    headers['X-Sprite-Id'] = 'Sidekick';
    response = await post('/api/projects/sprites/delete', {});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).project.activeSpriteId, 'Enemy');
    headers['X-Sprite-Id'] = 'Enemy';
    response = await post('/api/projects/sprites/delete', {});
    assert.equal(response.status, 200);
    const noCharacters = await response.json();
    assert.deepEqual(noCharacters.project.sprites, []);
    assert.equal(noCharacters.project.activeSpriteId, '');
    assert.equal(noCharacters.activeAnimationId, '');
    assert.deepEqual(noCharacters.animations, []);
    assert.deepEqual(noCharacters.frames, []);
    assert.equal(noCharacters.spriteUrl, null);
    assert.deepEqual(await readdir(path.join(root, 'demo/sprites')), []);
    assert.equal(await readFile(soundFile, 'utf8'), soundBefore);
    assert.deepEqual((await (await post('/api/projects/load', { name: 'demo' })).json()).project.sprites, []);
    delete headers['X-Sprite-Id'];
    delete headers['X-Animation-Id'];
    assert.equal((await post('/api/projects/sprites/new', { value: 'researcher' })).status, 200,
      'a deleted character name can be reused');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
