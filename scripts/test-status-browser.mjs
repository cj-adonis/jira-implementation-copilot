// Tests status updates against local fixtures; never connects to live Jira.
// Requires npm run build and an installed Chrome/Edge (or BROWSER_PATH).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'apps/web/dist');
const browser = [process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(existsSync);
assert(browser, 'Install Chrome/Edge or set BROWSER_PATH.');
assert(existsSync(join(dist, 'index.html')), 'Run npm run build first.');
const requests = [];
let connected = true, loginCount = 0, htmlStatus = false, freshChecks = 0;
let writeCount = 0, partial = false, failChoices = false;
const writes = [];
let progress = { phase: 'idle', startedAt: null, message: '' };
const issue = { key: 'TEST-1', summary: 'Connection fixture issue', status: 'Open', description: 'Test details',
  browseUrl: null, issueType: 'Task', priority: null, components: [], labels: [], reporter: null, assignee: null,
  created: null, updated: null, comments: [], attachments: [], linkedIssues: [] };
const tickets = Array.from({ length: 12 }, (_, index) => ({ ...issue, key: 'TEST-' + (index + 1), summary: 'Status fixture ' + (index + 1) }));
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  requests.push(path);
  const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  try {
    if (path === '/api/jira/connection-progress') return json(progress);
    if (path === '/api/jira/status') {
      if (new URL(req.url, 'http://localhost').searchParams.get('fresh') === 'true') freshChecks++;
      if (htmlStatus) { res.writeHead(502, { 'Content-Type': 'text/html' }); return res.end('<html>Proxy unavailable</html>'); }
      return json({ sites: [{ service: 'jira', site: 'mx', logged_in: connected }] });
    }
    if (path === '/api/jira/login') {
      loginCount++;
      progress = { phase: 'browser', startedAt: Date.now(), message: 'Waiting for fixture SSO' };
      return json(progress, 202);
    }
    if (path.startsWith('/api/')) {
      if (!connected) return json({ error: 'Session expired. Select Connect Jira.' }, 401);
      if (path === '/api/issues/assigned') {
        const filter = new URL(req.url, 'http://localhost').searchParams.get('status');
        return json({ issues: tickets.filter(ticket => !filter || ticket.status === filter) });
      }
      if (path.endsWith('/transitions')) {
        if (failChoices) return json({ error: 'Choices unavailable' }, 403);
        const key = path.split('/')[3];
        return json({ transitions: key === 'TEST-12' ? [] : [{ id: key === 'TEST-2' ? '42' : '31', name: 'Start work', to: 'In Progress' }] });
      }
      if (path.endsWith('/status') && req.method === 'POST') {
        let body = ''; for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body);
        const updates = payload.updates ?? [{ key: path.split('/')[3], transitionId: payload.transitionId }];
        writeCount++; writes.push(updates);
        await delay(200);
        return json({ results: updates.map((update, index) => {
          if (partial && index === 1) return { key: update.key, outcome: 'failed', message: 'Missing permission' };
          tickets.find(ticket => ticket.key === update.key).status = 'In Progress';
          return { key: update.key, outcome: 'updated', message: 'Updated to In Progress.' };
        }) });
      }
      if (/^\/api\/issues\/TEST-\d+$/.test(path)) return json(tickets.find(ticket => ticket.key === path.split('/')[3]));
      if (path === '/api/issues/TEST-1') return json(issue);
      if (path.endsWith('/insights')) return json({ dates: null, watchers: null, worklog: null, transitions: null });
      if (path === '/api/boards') return json({ boards: [{ id: 1, name: 'Fixture board', type: 'scrum' }] });
      if (path.endsWith('/sprints')) return json({ sprints: [{ id: 1, name: 'Fixture sprint', state: 'active' }] });
      if (path === '/api/issues/comment-activity') return json({ items: [] });
      return json({ error: 'Unknown fixture endpoint' }, 404);
    }
    const asset = resolve(dist, '.' + (path === '/' ? '/index.html' : path));
    if (!asset.startsWith(dist + '/') && !asset.startsWith(dist + '\\')) return json({}, 404);
    const data = await readFile(asset);
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(asset)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(data);
  } catch { json({ error: 'Fixture not found' }, 404); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = 'http://127.0.0.1:' + server.address().port;
const profile = await mkdtemp(join(tmpdir(), 'jira-status-test-'));
let child, socket, nextId = 0, sessionId;
const pending = new Map();
const rpc = (method, params = {}, page = true) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
  pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
  socket.send(JSON.stringify({ id, method, params, ...(page && sessionId ? { sessionId } : {}) }));
});
const evaluate = async expression => {
  const result = await rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
};
async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(150); }
  throw new Error('Timed out: ' + label + '\n' + await evaluate('document.body.innerText') + '\nRequests: ' + requests.join(', '));
}
const bodyContains = text => evaluate('document.body.innerText.includes(' + JSON.stringify(text) + ')');
const click = text => evaluate('(() => { const scope = [...document.querySelectorAll("dialog[open]")].at(-1) ?? document; const button = [...scope.querySelectorAll("button")].find(b => b.getClientRects().length && b.textContent.trim() === ' + JSON.stringify(text) + '); if (!button || button.disabled) throw new Error("Button unavailable"); button.click(); })()');
const pass = text => console.log('PASS ' + text);
try {
  child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let launchError;
  child.on('error', error => { launchError = error; });
  child.stderr.on('data', () => {});
  let endpoint;
  await until(async () => {
    if (launchError) throw launchError;
    try { const [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); endpoint = 'ws://127.0.0.1:' + port + path; return true; } catch { return false; }
  }, 'headless browser startup');
  socket = new WebSocket(endpoint);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  socket.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.exceptionThrown') console.error(JSON.stringify(data.params));
  const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error.message)); else request.resolve(data.result);
  };
  const target = await rpc('Target.createTarget', { url: 'about:blank' }, false);
  ({ sessionId } = await rpc('Target.attachToTarget', { targetId: target.targetId, flatten: true }, false));
  await rpc('Page.enable');
  await rpc('Runtime.enable');
  await rpc('Page.navigate', { url: origin });
  await until(() => bodyContains('Status fixture 1'), 'assigned issues');
  const clickSelector = selector => evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()');
  const selectValue = (selector, value) => evaluate('(() => { const select = document.querySelector(' + JSON.stringify(selector) + '); select.value = ' + JSON.stringify(value) + '; select.dispatchEvent(new Event("change", { bubbles: true })); })()');
  const openChoice = async key => {
    await clickSelector('[aria-label="Update status for ' + key + '"]');
    await until(() => evaluate('!!document.querySelector("dialog select option[value] + option")'), 'transition choices');
  };
  const choose = async key => {
    await selectValue('#transition-' + key, key === 'TEST-2' ? '42' : '31');
  };
  await openChoice('TEST-1');
  await choose('TEST-1');
  await click('Review changes');
  assert.equal(writeCount, 0);
  assert(await bodyContains('Apply these status changes in Jira MX?'));
  await click('Close');
  assert.equal(writeCount, 0);
  pass('review and cancel do not write');

  await openChoice('TEST-1');
  await choose('TEST-1');
  await click('Review changes');
  await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent === "Confirm update").click(); [...document.querySelectorAll("button")].find(b => b.textContent === "Confirm update").click();');
  await until(() => bodyContains('1 of 1 updated.'), 'single update result');
  assert.equal(writeCount, 1);
  await click('Done');
  await until(() => evaluate('document.querySelector(".ticket-row .status-tag").textContent === "In Progress"'), 'list status refresh');
  pass('individual update submits once and refreshes the list');

  await clickSelector('.ticket-row');
  await until(() => bodyContains('Test details'), 'issue detail');
  await click('Update status');
  await until(() => evaluate('document.querySelector("#transition-TEST-1")?.options.length > 1'), 'detail status choices');
  await choose('TEST-1');
  await click('Review changes');
  await click('Confirm update');
  await until(() => bodyContains('1 of 1 updated.'), 'detail update');
  await click('Done');
  await click('Close preview');
  await click('My issues');
  await until(() => bodyContains('Status fixture 2'), 'return to list');
  pass('issue detail supports status updates');

  await clickSelector('[aria-label="Select TEST-2"]');
  await click('Next');
  await clickSelector('[aria-label="Select TEST-11"]');
  assert(await bodyContains('2 selected'));
  await click('Update selected');
  await until(() => evaluate('!document.querySelector(".status-common select").disabled'), 'shared status choices');
  await selectValue('.status-common select', 'In Progress');
  assert.equal(await evaluate('document.querySelector("#transition-TEST-2").value'), '42');
  assert.equal(await evaluate('document.querySelector("#transition-TEST-11").value'), '31');
  partial = true;
  await click('Review changes');
  await click('Confirm update');
  await until(() => bodyContains('1 of 2 updated.'), 'partial results');
  assert(await bodyContains('Missing permission'));
  assert.deepEqual(writes.at(-1), [{ key: 'TEST-2', transitionId: '42' }, { key: 'TEST-11', transitionId: '31' }]);
  await click('Done');
  assert(await bodyContains('0 selected'));
  pass('cross-page batch uses each workflow ID and reports partial failure');

  await clickSelector('[aria-label="Update status for TEST-12"]');
  await until(() => bodyContains('No transitions are available'), 'empty choices');
  assert(await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent === "Review changes").disabled'));
  await click('Close');
  pass('issues with no transitions cannot be submitted');

  failChoices = true;
  await clickSelector('[aria-label="Update status for TEST-11"]');
  await until(() => bodyContains('Choices unavailable'), 'choice error');
  assert(await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent === "Review changes").disabled'));
  failChoices = false;
  await click('Try again');
  await until(() => evaluate('!document.querySelector("#transition-TEST-11").disabled'), 'choices recover');
  await click('Close');
  pass('failed choice reads show an error and can be retried');

  await click('Previous');
  await clickSelector('.batch-toolbar input');
  assert(await bodyContains('10 selected'));
  await selectValue('[aria-label="Status filter"]', 'In Progress');
  await click('Apply filters');
  await until(() => bodyContains('0 selected'), 'selection reset');
  pass('select page and filter changes keep selection explicit');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
  pass('task controls fit a phone-sized viewport');
  console.log('8 status browser scenarios passed.');

} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await rpc('Browser.close', {}, false); } catch {}
    socket.close();
  }
  if (child && child.exitCode === null) {
    await Promise.race([new Promise(done => child.once('exit', done)), delay(3000)]);
    if (child.exitCode === null) child.kill();
  }
  server.closeAllConnections();
  await new Promise(done => server.close(done));
  // Delete only this run's generated temporary profile.
  assert.equal(dirname(profile), resolve(tmpdir()));
  assert(profile.startsWith(join(tmpdir(), 'jira-status-test-')));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
