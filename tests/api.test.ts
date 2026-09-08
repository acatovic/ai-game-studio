import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

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
    assert.equal((await post('/api/projects/draft', {})).status, 400);
    let response = await post('/api/projects/new', { name: 'demo' });
    assert.equal(response.status, 200);
    const view = await response.json();
    headers = { ...headers, 'X-Project-Name': view.name, 'X-Sprite-Id': view.project.activeSpriteId };
    response = await post('/api/projects/draft', { spritePrompt: 'hero', motionPrompt: '', spriteModel: 'openai/gpt-image-2', motionModel: 'x-ai/grok-imagine-video' });
    assert.equal(response.status, 200);
    response = await fetch(base + '/projects/demo/sprites/sprite-1/sprite.json');
    assert.equal((await response.json()).spritePrompt, 'hero');
    response = await post('/api/projects/sprites/new', { value: 'Enemy' });
    assert.equal((await response.json()).spritePrompt, '');
    // Requests from the original tab still update the original sprite.
    response = await post('/api/projects/draft', { spritePrompt: 'hero revised', motionPrompt: '', spriteModel: 'openai/gpt-image-2', motionModel: 'x-ai/grok-imagine-video' });
    assert.equal((await response.json()).spritePrompt, 'hero revised');
    assert.deepEqual(await readdir(root), ['demo']);
    assert.equal((await post('/api/projects/new', { name: '../escape' })).status, 400);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  }
});
