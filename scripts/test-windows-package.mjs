// Local-only smoke test: no Jira/SSO requests, no browser launch.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

let directory = process.argv[2];
if (!directory) {
  const builds = (await readdir('release')).filter(name => name.startsWith('build-')).sort();
  assert(builds.length, 'Run npm run package:windows first.');
  directory = join('release', builds.at(-1), 'Jira MX Workspace');
}
const root = resolve(directory);
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const instance = randomUUID();
const env = { ...process.env, PORT: String(port), NODE_ENV: 'production', JIRA_DESKTOP: '1', JIRA_DESKTOP_INSTANCE: instance };
delete env.NODE_OPTIONS;
const child = spawn(join(root, 'runtime/node.exe'), [join(root, 'apps/api/dist/server.mjs')], {
  cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { output += data; });
const exit = once(child, 'exit');
const base = `http://127.0.0.1:${port}`;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert(child.exitCode === null, `Packaged server exited: ${output}`);
    try {
      const response = await fetch(base + '/api/health');
      const health = await response.json();
      assert.equal(health.app, 'jira-mx-workspace');
      assert.equal(health.desktopInstance, instance);
      ready = true;
      break;
    } catch { await delay(100); }
  }
  assert(ready, `Packaged server did not become ready: ${output}`);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]);
  assert(assets.length >= 2, 'Expected built JavaScript and CSS.');
  for (const asset of assets) {
    const response = await fetch(base + asset);
    assert.equal(response.status, 200, asset);
    assert(!response.headers.get('content-type').includes('text/html'), asset);
  }
  for (const path of ['/api/not-a-route', '/assets/missing.js', '/.env', '/package.json', '/scripts/jira-login.py']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(base + '/work')).status, 200);
  for (const file of ['jira-login.py', 'jira-workspace.py']) {
    assert((await readFile(join(root, 'scripts', file), 'utf8')).length > 100);
  }
  // The launcher's redirected stdin is also the server's lifetime signal.
  child.stdin.end();
  const [code] = await Promise.race([exit, delay(7000, undefined, { ref: false }).then(() => { throw new Error('Server did not stop after launcher pipe closed.'); })]);
  assert.equal(code, 0, output);
  console.log('PASS packaged runtime: UI, assets, API, private files, adapters, shutdown.');
} finally {
  if (child.exitCode === null) { child.kill(); await exit; }
}

if (process.platform === 'win32') {
  // Exercise the actual native EXE, including duplicate launches and crash cleanup.
  const desktopBase = 'http://127.0.0.1:43821';
  const portProbe = createServer();
  try {
    await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(43821, '127.0.0.1', resolve); });
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    console.log('SKIP native launcher test: port 43821 is already in use.');
    process.exit(0);
  }
  await new Promise(resolve => portProbe.close(resolve));
  const launcher = spawn(join(root, 'Jira MX Workspace.exe'), ['--no-browser'], { cwd: root, windowsHide: true });
  const launcherExit = once(launcher, 'exit');
  const health = async () => (await fetch(desktopBase + '/api/health', { signal: AbortSignal.timeout(1000) })).json();
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await predicate()) return;
      await delay(100);
    }
    throw new Error('Native launcher check timed out.');
  };
  try {
    let instance;
    await waitFor(async () => {
      try { instance = (await health()).desktopInstance; return Boolean(instance); } catch { return false; }
    });
    const duplicate = spawn(join(root, 'Jira MX Workspace.exe'), ['--no-browser'], { cwd: root, windowsHide: true });
    try {
      const [code] = await Promise.race([once(duplicate, 'exit'), delay(20000, undefined, { ref: false }).then(() => { throw new Error('Duplicate launcher did not exit.'); })]);
      assert.equal(code, 0);
    } finally { if (duplicate.exitCode === null) duplicate.kill(); }
    assert.equal((await health()).desktopInstance, instance, 'Duplicate launch must reuse the server.');
    launcher.kill();
    await launcherExit;
    await waitFor(async () => { try { await health(); return false; } catch { return true; } });
    console.log('PASS native EXE: startup, duplicate instance, server cleanup after launcher exit.');
  } finally {
    if (launcher.exitCode === null) { launcher.kill(); await launcherExit; }
  }
}
