// Tests the built UI against a local Jira fixture using an isolated headless browser.
// Requires npm run build and an installed Chrome/Edge (or BROWSER_PATH).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
let connected = false, loginCount = 0, htmlStatus = false, freshChecks = 0;
let statusGate = null;
let progress = { phase: 'idle', startedAt: null, message: '' };
const quickWrites = [];
let uncertainQuickAction = false;
const day = offset => { const date = new Date(); date.setDate(date.getDate() + offset); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const issue = { key: 'TEST-1', summary: 'Connection fixture issue', status: 'Open', description: 'Test details',
  browseUrl: null, issueType: 'Task', priority: null, components: [], labels: [], reporter: null, assignee: null,
  created: null, updated: null, comments: [], attachments: [], linkedIssues: [] };
issue.comments = Array.from({ length: 26 }, (_, index) => ({ author: index % 2 ? 'Alex' : 'Jane',
  created: `2020-01-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
  body: `Historical comment ${index + 1}. ` + 'Full comment text. '.repeat(15) + `End of comment ${index + 1}.` }));
const tickets = [issue, ...Array.from({ length: 8 }, (_, index) => ({ ...issue, key: 'TEST-' + (index + 2), summary: 'Additional issue ' + (index + 2), comments: [] }))];
tickets.forEach((ticket, index) => Object.assign(ticket, { dueDate: index === 0 ? day(-1) : index === 1 ? day(0) : null, priority: index === 0 ? 'High' : 'Medium', statusCategory: index < 3 ? 'new' : index < 6 ? 'indeterminate' : 'done', status: index === 0 ? 'Open' : index < 3 ? 'Ready for dev' : index < 6 ? 'QA Review' : 'Verified', blocked: index === 3, blockedReasons: index === 3 ? ['Blocked by TEST-2'] : [] }));
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  requests.push(path);
  const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  try {
    if (path === '/api/jira/connection-progress') return json(progress);
    if (path === '/api/jira/status') {
      if (statusGate) await statusGate;
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
      if (path === '/api/issues/assigned') return json({ issues: tickets });
      if (/^\/api\/issues\/TEST-\d+$/.test(path)) return json(tickets.find(ticket => ticket.key === path.split('/')[3]));
      if (path.endsWith('/edit-options')) {
        const target = tickets.find(ticket => ticket.key === path.split('/')[3]);
        return json({ priorities: [{ id: '1', name: 'Urgent' }, { id: '2', name: 'High' }, { id: '3', name: 'Medium' }], priority: target.priority, dueDate: target.dueDate, dueDateEditable: true });
      }
      if (path.endsWith('/quick-action') && req.method === 'POST') {
        let body = ''; for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body), target = tickets.find(ticket => ticket.key === path.split('/')[3]);
        quickWrites.push({ key: target.key, ...payload });
        await delay(150);
        if (uncertainQuickAction) return json({ outcome: 'unknown', message: 'This change may have reached Jira. Check the issue before trying again.' });
        if (payload.action === 'comment') target.comments.push({ author: 'You', body: payload.body, created: new Date().toISOString() });
        if (payload.action === 'priority') target.priority = { '1': 'Urgent', '2': 'High', '3': 'Medium' }[payload.priorityId];
        if (payload.action === 'dueDate') target.dueDate = payload.dueDate;
        return json({ outcome: 'updated', message: payload.action === 'comment' ? 'Comment added.' : payload.action === 'priority' ? 'Priority updated.' : 'Due date updated.' });
      }
      if (path.endsWith('/insights')) return json({ dates: null, watchers: null, worklog: null, transitions: null });
      if (path === '/api/boards') return json({ boards: [{ id: 1, name: 'Fixture board', type: 'scrum' }] });
      if (path.endsWith('/sprints')) return json({ sprints: [{ id: 1, name: 'Fixture sprint', state: 'active' }] });
      if (path === '/api/issues/comment-activity') return json({ items: new URL(req.url, 'http://localhost').searchParams.get('keys').split(',').map(key => {
        const comments = key === 'TEST-1' ? issue.comments : key === 'TEST-9' ? [{ author: 'Sam', created: null, body: 'Undated comment from the second batch.' }] : [];
        return { key, count: comments.length, comments, latest: comments.at(-1) ?? null };
      }) });
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
const profile = await mkdtemp(join(tmpdir(), 'jira-connection-test-'));
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
  throw new Error('Timed out: ' + label);
}
const bodyContains = text => evaluate('document.body.innerText.includes(' + JSON.stringify(text) + ')');
const click = text => evaluate('(() => { const scope = [...document.querySelectorAll("dialog[open]")].at(-1) ?? document; const button = [...scope.querySelectorAll("button")].find(b => b.getClientRects().length && b.textContent.trim() === ' + JSON.stringify(text) + '); if (!button || button.disabled) throw new Error("Button unavailable: " + ' + JSON.stringify(text) + '); button.click(); })()');
const pass = text => console.log('PASS ' + text);
const settleVisuals = () => evaluate('(async () => { await new Promise(requestAnimationFrame); await Promise.all(document.getAnimations().filter(animation => animation.constructor.name === "CSSTransition").map(animation => animation.finished.catch(() => {}))); })()');
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
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error.message)); else request.resolve(data.result);
  };
  const target = await rpc('Target.createTarget', { url: 'about:blank' }, false);
  ({ sessionId } = await rpc('Target.attachToTarget', { targetId: target.targetId, flatten: true }, false));
  await rpc('Page.enable');
  await rpc('Page.navigate', { url: origin });
  await until(() => bodyContains('Not connected'), 'cold connection state');
  assert(!requests.includes('/api/issues/assigned'));
  pass('cold session offers Connect without fetching Jira work');

  await click('Connect Jira');
  await until(() => bodyContains('Waiting for fixture SSO'), 'login progress');
  assert.equal(loginCount, 1);
  assert(await evaluate('document.querySelector(".connection-loading [role=progressbar]") !== null'));
  assert(await evaluate('document.querySelector(".work-panel").getClientRects().length === 0'));
  assert(await evaluate('document.querySelector(".connection-loading button:disabled") === null'));
  pass('Connect shows an animated loading experience and replaces inactive workspace controls');

  const setLoadingTheme = value => evaluate('(() => { const select = document.querySelector("[aria-label=Appearance]"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, ' + JSON.stringify(value) + '); select.dispatchEvent(new Event("change", { bubbles: true })); })()');
  for (const width of [1280, 320]) {
    await rpc('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    for (const theme of ['light', 'dark']) {
      await setLoadingTheme(theme);
      assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `Connection loading overflows at ${width}px in ${theme} theme`);
      if (process.env.UI_SCREENSHOT_DIR) {
        await settleVisuals();
        const shot = await rpc('Page.captureScreenshot', { format: 'png' });
        await writeFile(join(process.env.UI_SCREENSHOT_DIR, `jira-connecting-${theme}-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
  }
  await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".orbit-outer")).animationName'), 'none');
  await rpc('Emulation.setEmulatedMedia', { features: [] });
  await setLoadingTheme('system');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  pass('connection loading fits phones and desktops in both themes and respects reduced motion');

  assert(await evaluate('[...document.querySelectorAll(".topbar button, .topbar input, .topbar select")].every(control => control.disabled)'));
  await evaluate('document.querySelectorAll(".main-nav button")[1].click()');
  assert.equal(await evaluate('document.querySelector(".main-nav [aria-current=page]")?.textContent'), 'My issues');
  await rpc('Page.reload');
  await until(() => bodyContains('Waiting for fixture SSO'), 'resume progress after reload');
  assert.equal(loginCount, 1);
  pass('navigation is disabled and reload follows the existing login');

  connected = true;
  progress = { ...progress, phase: 'connected', message: 'Connected' };
  await until(() => evaluate('[...document.querySelectorAll("h2")].some(h => h.textContent === "Jira is ready")'), 'SSO completion');
  assert(await evaluate('[...document.querySelectorAll(".topbar button, .topbar input, .topbar select")].every(control => !control.disabled)'));
  await click('Boards');
  await click('Find boards');
  await until(() => bodyContains('Fixture board'), 'boards load after connection');
  await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent.includes("Fixture board")).click()');
  await until(() => bodyContains('Fixture sprint'), 'sprints load');
  pass('successful SSO unlocks boards and sprints');

  await click('My issues');
  await until(() => bodyContains('Connection fixture issue'), 'assigned issues load');
  await evaluate('document.querySelector(".ticket-row").click()');
  await until(() => bodyContains('Test details'), 'issue loads');
  await click('Open full issue');
  assert(await evaluate('[...document.querySelectorAll("h2")].some(h => h.textContent === "Jira is ready")'));
  pass('issue detail page retains connection controls');

  const loginsBeforeReload = loginCount;
  const probesBeforeReload = requests.filter(path => path === '/api/jira/status').length;
  let releaseStatus;
  statusGate = new Promise(resolve => { releaseStatus = resolve; });
  try {
    await rpc('Page.reload');
    await until(() => requests.filter(path => path === '/api/jira/status').length > probesBeforeReload, 'background session validation after reload');
    assert(await bodyContains('Jira is ready'), 'A recent connection must survive reload while validation is pending.');
    assert(await evaluate('document.querySelector(".connection-loading") === null'), 'Reload must not show the SSO animation.');
    assert(await evaluate('document.querySelector(".issue-header")?.getClientRects().length > 0'), 'The workspace must remain visible during background validation.');
    assert.equal(loginCount, loginsBeforeReload, 'Reload must not launch login.');
  } finally { statusGate = null; releaseStatus(); }
  await until(() => evaluate('[...document.querySelectorAll(".connection-card button")].some(button => button.textContent.trim() === "Refresh" && !button.disabled)'), 'background validation completes');
  pass('reload preserves the connected workspace while checking the session in the background');

  connected = false;
  await click('Refresh');
  await until(() => bodyContains('Not connected'), 'expired session');
  await click('Connect Jira');
  await until(() => bodyContains('Waiting for fixture SSO'), 'reconnect progress');
  progress = { ...progress, phase: 'error', message: 'Fixture VPN unavailable' };
  await until(() => bodyContains('Fixture VPN unavailable'), 'login failure');
  assert.equal(freshChecks, 1, 'Manual refresh must bypass the session cache');
  pass('expired sessions can reconnect and background failures are visible');

  await click('Connect Jira');
  await until(() => bodyContains('Waiting for fixture SSO'), 'retry progress');
  const issueReads = requests.filter(path => path === '/api/issues/TEST-1').length;
  connected = true;
  progress = { ...progress, phase: 'connected', message: 'Connected' };
  await until(() => evaluate('[...document.querySelectorAll("h2")].some(h => h.textContent === "Jira is ready")'), 'retry succeeds');
  await until(() => requests.filter(path => path === '/api/issues/TEST-1').length > issueReads, 'issue refresh after reconnect');
  pass('retry succeeds and refreshes the open issue');

  htmlStatus = true;
  await click('Refresh');
  await until(() => bodyContains('unreadable response'), 'proxy response error');
  assert(!(await bodyContains('Your Samsung SSO session is active.')));
  htmlStatus = false;
  await click('Check connection');
  await until(() => evaluate('[...document.querySelectorAll("h2")].some(h => h.textContent === "Jira is ready")'), 'manual connection recovery');
  pass('non-JSON proxy failure is readable and Check connection recovers');
  await rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await until(() => evaluate('document.documentElement.dataset.theme === "dark"'), 'system dark theme');
  const selectValue = (selector, value) => evaluate('(() => { const select = document.querySelector(' + JSON.stringify(selector) + '); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; setter.call(select, ' + JSON.stringify(value) + '); select.dispatchEvent(new Event("change", { bubbles: true })); })()');
  await selectValue('[aria-label="Appearance"]', 'light');
  await until(() => evaluate('document.documentElement.dataset.theme === "light"'), 'explicit light theme');
  await selectValue('[aria-label="Appearance"]', 'dark');
  await rpc('Page.reload');
  await until(() => evaluate('document.querySelector("[aria-label=Appearance]")?.value === "dark"'), 'saved dark preference');
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
  assert.equal(await evaluate('getComputedStyle(document.documentElement).colorScheme'), 'dark');
  pass('appearance follows system preference and persists explicit choices after reload');

  await until(() => evaluate('document.querySelectorAll(".comment").length === 26'), 'all issue comments');
  await selectValue('[aria-label="Conversation order"]', 'oldest');
  assert(await evaluate('document.querySelector(".comment p").textContent.includes("Historical comment 1.")'));
  pass('issue details retain more than ten comments and support chronological sorting');

  const search = (selector, value) => evaluate('(() => { const input = document.querySelector(' + JSON.stringify(selector) + '); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ' + JSON.stringify(value) + '); input.dispatchEvent(new Event("input", { bubbles: true })); })()');
  await search('.detail-card input[type="search"]', 'Jane');
  await until(() => evaluate('document.querySelectorAll(".comment").length === 13'), 'issue comment author search');
  await search('.detail-card input[type="search"]', 'End of comment 26.');
  await until(() => evaluate('document.querySelectorAll(".comment").length === 1'), 'full issue comment text search');
  assert(await bodyContains('End of comment 26.'));
  pass('full comment text and author search remain available inside each issue');

  await evaluate('localStorage.setItem("jira-copilot-workspace-v2", JSON.stringify({ view: "activity", selected: "TEST-1", returnView: "activity" }))');
  await rpc('Page.reload');
  await until(() => evaluate('document.querySelector("h1")?.textContent === "My issues"'), 'restore removed comments view');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".main-nav button")].map(button => button.textContent)'), ['My issues', 'Boards']);
  assert(!requests.includes('/api/issues/comment-activity'));
  await until(() => evaluate('document.querySelectorAll(".ticket-row").length === 9'), 'assigned issues after restoring older navigation');
  await evaluate('document.querySelector(".ticket-row").click()');
  await until(() => bodyContains('Test details'), 'open issue after restoring older navigation');
  await click('Close preview');
  pass('older saved comments navigation falls back to My issues and no inbox requests run');

  await click('My issues');
  await until(() => evaluate('document.querySelectorAll(".ticket-row").length === 9'), 'work list returns');
  await search('.search-field input', 'no-matching-ticket');
  await until(() => bodyContains('No issues match your filters'), 'empty filtered work list');
  await click('Clear filters');
  await until(() => evaluate('document.querySelectorAll(".ticket-row").length === 9'), 'reset issue filters');
  pass('issue filters explain empty results and reset with one action');

  await rpc('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  assert(await bodyContains('Blocked by TEST-2'));
  assert(await evaluate('document.querySelector(".ticket-table .due-tag.overdue") !== null'));
  await selectValue('[aria-label="Sort issues"]', 'due');
  assert.deepEqual(await evaluate('[...document.querySelectorAll(".ticket-row .ticket-key")].slice(0,2).map(node => node.textContent)'), ['TEST-1', 'TEST-2']);
  await evaluate(`document.querySelector('.ticket-table [aria-label="Pin TEST-3"]').click()`);
  assert(await evaluate('document.querySelector(".today-task .today-open strong").textContent === "TEST-3"'));
  await rpc('Page.reload');
  await until(() => evaluate(`document.querySelector('.ticket-table [aria-label="Unpin TEST-3"]') !== null`), 'saved Today pin');
  for (const key of ['TEST-4', 'TEST-5', 'TEST-6', 'TEST-7', 'TEST-8']) await evaluate(`document.querySelector('.ticket-table [aria-label="Pin ${key}"]').click()`);
  await until(() => bodyContains('Your Today list has five pins'), 'Today pin limit');
  assert.equal(await evaluate('document.querySelectorAll(".today-panel > .today-list > .today-task").length'), 5);
  assert(await bodyContains('2 more issues due soon or overdue'));
  pass('Today pins persist, enforce a five-task focus, and deadline sorting exposes blockers');

  await search('.search-field input', 'Additional issue');
  await until(() => evaluate('document.querySelectorAll(".ticket-row").length === 8'), 'filtered list for preview');
  await evaluate('window.scrollTo(0, 350)');
  const scrollBeforePreview = await evaluate('window.scrollY');
  await evaluate('document.querySelector(".ticket-row").click()');
  await until(() => evaluate('document.querySelector(".issue-preview[open] h2")?.textContent === "Additional issue 2"'), 'issue preview');
  assert.equal(await evaluate('document.querySelector(".search-field input").value'), 'Additional issue');
  assert.equal(await evaluate('document.querySelectorAll(".ticket-row").length'), 8);
  assert(Math.abs(await evaluate('window.scrollY') - scrollBeforePreview) < 15, 'Opening preview should preserve list scroll');
  await evaluate('document.querySelector(".issue-preview .issue-subtitle [aria-label]").click()');
  await until(() => evaluate('document.querySelector(".quick-action-dialog[open]") !== null'), 'nested quick actions');
  await rpc('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await rpc('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(() => evaluate('document.querySelector(".quick-action-dialog[open]") === null && document.querySelector(".issue-preview[open]") !== null'), 'Escape closes only the nested action editor');
  await evaluate('document.querySelectorAll(".ticket-row")[1].click()');
  await until(() => evaluate('document.querySelector(".issue-preview[open] h2")?.textContent === "Additional issue 3"'), 'switch preview task');
  await click('Open full issue');
  await until(() => bodyContains('← My issues'), 'expanded issue');
  await click('← My issues');
  assert.equal(await evaluate('document.querySelector(".search-field input").value'), 'Additional issue');
  await click('Clear filters');
  pass('issue preview preserves filters and scroll, switches tasks, and expands to full details');

  const setText = (selector, value) => evaluate('(() => { const input = document.querySelector(' + JSON.stringify(selector) + '); const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, ' + JSON.stringify(value) + '); input.dispatchEvent(new Event("input", { bubbles: true })); })()');
  const openQuick = async (key = 'TEST-1') => {
    await evaluate(`document.querySelector('.ticket-table [aria-label="Quick actions for ${key}"]').click()`);
    await until(() => evaluate('document.querySelector(".quick-action-dialog[open]") !== null'), 'quick actions dialog');
  };
  await openQuick();
  await setText('[aria-label="Comment"]', 'Progress from quick actions.');
  await click('Review change');
  assert.equal(quickWrites.length, 0);
  await click('Close');
  assert.equal(quickWrites.length, 0);
  await openQuick();
  await setText('[aria-label="Comment"]', 'Progress from quick actions.');
  await click('Review change');
  await evaluate('const confirm = [...document.querySelectorAll(".quick-action-dialog button")].find(button => button.textContent === "Confirm change"); confirm.click(); confirm.click();');
  await until(() => bodyContains('Comment added.'), 'quick comment submitted');
  assert.equal(quickWrites.length, 1);
  assert.equal(quickWrites[0].confirmed, true);
  await click('Done');
  pass('quick comment review and cancel do not write, and duplicate clicks submit once');

  await openQuick();
  await selectValue('[aria-label="Quick action"]', 'priority');
  await until(() => evaluate(`document.querySelector('[aria-label="New priority"]')?.options.length === 4`), 'editable priorities');
  await selectValue('[aria-label="New priority"]', '1');
  await click('Review change');
  assert(await bodyContains('Urgent'));
  await click('Confirm change');
  await until(() => bodyContains('Priority updated.'), 'quick priority submitted');
  await click('Done');
  await until(() => evaluate(`document.querySelector('[aria-label="Select TEST-1"]').closest('.selectable-ticket').querySelector('.priority-tag').textContent === 'Urgent'`), 'priority row refresh');
  await openQuick();
  await selectValue('[aria-label="Quick action"]', 'dueDate');
  await until(() => evaluate(`document.querySelector('[aria-label="New due date"]') && !document.querySelector('[aria-label="New due date"]').disabled`), 'editable due date');
  await setText('[aria-label="New due date"]', day(1));
  await click('Review change');
  await click('Confirm change');
  await until(() => bodyContains('Due date updated.'), 'quick due date submitted');
  await click('Done');
  await until(() => evaluate('document.querySelector(".today-counts .overdue-text") === null'), 'Today deadlines refresh');
  assert.deepEqual(quickWrites.map(write => write.action), ['comment', 'priority', 'dueDate']);
  pass('quick priority and due date edits use Jira choices and refresh rows and Today');

  uncertainQuickAction = true;
  await openQuick('TEST-2');
  await setText('[aria-label="Comment"]', 'An uncertain fixture update.');
  await click('Review change');
  await click('Confirm change');
  await until(() => bodyContains('This change may have reached Jira'), 'uncertain quick action');
  assert.equal(await evaluate('[...document.querySelectorAll(".quick-action-dialog button")].filter(button => button.textContent === "Confirm change").length'), 0);
  assert.equal(quickWrites.length, 4);
  await click('Done');
  uncertainQuickAction = false;
  pass('uncertain quick actions keep their result visible and do not offer a blind retry');

  await click('Board');
  await until(() => evaluate('document.querySelectorAll(".task-card").length === 9'), 'personal workflow board');
  assert.deepEqual((await evaluate('[...document.querySelectorAll(".column-heading h3")].map(node => node.textContent)')).sort(), ['Open', 'QA Review', 'Ready for dev', 'Verified'].sort());
  await evaluate(`document.querySelector('[aria-label="Select TEST-9"]').click()`);
  await click('List');
  assert(await evaluate(`document.querySelector('[aria-label="Select TEST-9"]').checked`));
  await click('Board');
  await rpc('Page.reload');
  await until(() => evaluate('document.querySelectorAll(".task-card").length === 9'), 'saved board layout');
  pass('List and Board share selection, use actual workflow statuses, and remember layout');

  for (const width of [320, 390, 768, 1280]) {
    await rpc('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    for (const theme of ['light', 'dark']) {
      await selectValue('[aria-label="Appearance"]', theme);
      for (const view of ['My issues', 'Boards']) {
        await click(view);
        if (view === 'My issues') for (const layout of ['Board', 'List']) {
          await click(layout);
          assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `${layout} overflows at ${width}px in ${theme} theme`);
        }
        assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `${view} overflows at ${width}px in ${theme} theme`);
      }
    }
  }
  await click('My issues');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 320, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate('document.querySelector(".ticket-row").click()');
  await until(() => evaluate('document.querySelector(".issue-preview[open]")?.matches(":modal")'), 'modal mobile issue preview');
  assert(await evaluate('document.querySelector(".issue-preview").scrollWidth <= document.querySelector(".issue-preview").clientWidth'));
  await click('Close preview');
  pass('mobile preview is modal, fits a small phone, and returns to the task list');
  if (process.env.UI_SCREENSHOT_DIR) {
    await rpc('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await click('My issues');
    for (const theme of ['light', 'dark']) {
      await selectValue('[aria-label="Appearance"]', theme);
      await evaluate('window.scrollTo(0, 0)');
      await settleVisuals();
      const shot = await rpc('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(process.env.UI_SCREENSHOT_DIR, `jira-work-${theme}.png`), Buffer.from(shot.data, 'base64'));
      await click('Board');
      await evaluate('document.querySelector(".work-panel").scrollIntoView({ block: "start" })');
      await settleVisuals();
      const boardShot = await rpc('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(process.env.UI_SCREENSHOT_DIR, `jira-board-${theme}.png`), Buffer.from(boardShot.data, 'base64'));
      await evaluate('document.querySelector(".board-open").click()');
      await until(() => evaluate('document.querySelector(".issue-preview[open]") !== null'), 'preview screenshot');
      await settleVisuals();
      const previewShot = await rpc('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(process.env.UI_SCREENSHOT_DIR, `jira-preview-${theme}.png`), Buffer.from(previewShot.data, 'base64'));
      await click('Close preview');
      await click('List');
      await evaluate(`document.querySelector('.ticket-table [aria-label^="Quick actions for"]').click()`);
      await until(() => evaluate('document.querySelector(".quick-action-dialog[open]") !== null'), 'quick action screenshot');
      await settleVisuals();
      const dialogShot = await rpc('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(process.env.UI_SCREENSHOT_DIR, `jira-dialog-${theme}.png`), Buffer.from(dialogShot.data, 'base64'));
      await click('Close');
      await click('Boards');
      await click('Find boards');
      await until(() => bodyContains('Fixture board'), 'team board screenshot');
      await evaluate('document.querySelector(".board-chip").click()');
      await until(() => bodyContains('Fixture sprint'), 'team sprint screenshot');
      await evaluate('window.scrollTo(0, 0)');
      await settleVisuals();
      const teamShot = await rpc('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(process.env.UI_SCREENSHOT_DIR, `jira-teams-${theme}.png`), Buffer.from(teamShot.data, 'base64'));
      await click('My issues');
    }
  }
  pass('work and boards fit phone, tablet, and desktop widths in both themes');
  console.log('22 browser scenarios passed.');
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
  assert(profile.startsWith(join(tmpdir(), 'jira-connection-test-')));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
