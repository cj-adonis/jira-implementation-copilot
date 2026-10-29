import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';
import { registerWeb } from './web.js';

describe('packaged web server', () => {
  const cleanups: Array<() => Promise<unknown>> = [];
  afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
  it('serves the UI and assets alongside the API without masking missing API routes or files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jira-web-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<html>Workspace fixture</html>');
    await writeFile(join(root, 'assets', 'app.js'), 'console.log("fixture")');
    const app = createApp();
    cleanups.push(() => app.close());
    await registerWeb(app, root);
    expect((await app.inject('/')).body).toContain('Workspace fixture');
    expect((await app.inject('/work')).body).toContain('Workspace fixture');
    expect((await app.inject('/assets/app.js')).headers['content-type']).toContain('javascript');
    expect((await app.inject('/api/health')).json().app).toBe('jira-mx-workspace');
    for (const path of ['/api/missing', '/assets/missing.js', '/assets/missing', '/missing.js', '/.env', '/%2e%2e/package.json']) {
      expect((await app.inject(path)).statusCode, path).toBe(404);
    }
    expect((await app.inject({ method: 'POST', url: '/work' })).statusCode).toBe(404);
  });
});
