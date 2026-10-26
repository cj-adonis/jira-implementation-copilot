import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, JiraClient, cliError, type JiraRunner } from './jira.js';
import { createApp } from './app.js';

const state = (logged_in: boolean) => ({ browser: { running: logged_in, headless: false }, sites: [{ service: 'jira', site: 'mx', logged_in }] });
afterEach(() => vi.restoreAllMocks());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
describe('Jira connection scenarios', () => {
  it('checks a cold session without launching login', async () => {
    const run = vi.fn<JiraRunner>().mockResolvedValue(state(false));
    expect(await new JiraClient(run).status()).toEqual(state(false));
    expect(run.mock.calls.map(call => call[0][0])).toEqual(['status']);
  });
  it('shares concurrent status probes', async () => {
    const run = vi.fn<JiraRunner>().mockResolvedValue(state(true));
    const jira = new JiraClient(run);
    await Promise.all([jira.status(), jira.status(), jira.status()]);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('reuses a signed-in browser without another login', async () => {
    const run = vi.fn<JiraRunner>().mockResolvedValue(state(true));
    const jira = new JiraClient(run);
    await jira.login();
    expect(run).toHaveBeenCalledTimes(1);
    expect(jira.connectionProgress().phase).toBe('connected');
  });
  it('logs into MX and publishes SSO progress', async () => {
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(state(false)).mockImplementationOnce(async (args, onInfo) => {
      expect(args).toEqual(['login', '--service', 'jira', '--site', 'mx', '--headed']);
      onInfo?.('waiting for SSO login in the open browser window');
      expect(jira.connectionProgress().phase).toBe('browser');
      return state(true);
    });
    const jira = new JiraClient(run);
    await expect(jira.login()).resolves.toEqual(state(true));
    expect(jira.connectionProgress().phase).toBe('connected');
  });
  it('shares repeated Connect requests and keeps reads behind the entire login', async () => {
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(state(false)).mockResolvedValueOnce(state(true))
      .mockResolvedValueOnce({ issues: [] });
    const jira = new JiraClient(run);
    const first = jira.login();
    const second = jira.login();
    expect(first).toBe(second);
    await Promise.all([first, second, jira.status(), jira.getAssignedIssues()]);
    expect(await jira.status()).toEqual(state(true));
    expect(run.mock.calls.map(call => call[0][0])).toEqual(['status', 'login', 'jira']);
  });
  it.each([null, {}, { sites: [] }, { sites: [{ service: 'jira', site: 'mx', logged_in: 'false' }] }, { sites: [{ service: 'jira', site: 'eu', logged_in: true }] }])('rejects malformed or wrong-site status %j', async value => {
    const run = vi.fn<JiraRunner>().mockResolvedValue(value);
    const jira = new JiraClient(run);
    await expect(jira.login()).rejects.toMatchObject({ statusCode: 502 });
    expect(jira.connectionProgress().phase).toBe('error');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('detects a login completed just after timeout', async () => {
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(state(false))
      .mockRejectedValueOnce(new AppError(504, 'Jira SSO timed out.'))
      .mockResolvedValueOnce(state(true));
    const jira = new JiraClient(run);
    await expect(jira.login()).resolves.toEqual(state(true));
    expect(jira.connectionProgress().phase).toBe('connected');
  });
  it('reports incomplete SSO even when the CLI exits successfully', async () => {
    const run = vi.fn<JiraRunner>().mockResolvedValue(state(false));
    const jira = new JiraClient(run);
    await expect(jira.login()).rejects.toMatchObject({ statusCode: 504 });
    expect(jira.connectionProgress().message).toContain('has not finished');
  });
  it('preserves the timeout when its recovery status probe also fails', async () => {
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(state(false))
      .mockRejectedValueOnce(new AppError(504, 'Jira SSO timed out.'))
      .mockRejectedValueOnce(new AppError(502, 'Browser unavailable'));
    await expect(new JiraClient(run).login()).rejects.toMatchObject({ statusCode: 504 });
  });
  it('can retry after a failed attempt without poisoning the command queue', async () => {
    const run = vi.fn<JiraRunner>().mockRejectedValueOnce(new AppError(503, 'Python missing')).mockResolvedValue(state(true));
    const jira = new JiraClient(run);
    await expect(jira.login()).rejects.toMatchObject({ statusCode: 503 });
    const failedAt = jira.connectionProgress().startedAt!;
    await expect(jira.login()).resolves.toEqual(state(true));
    expect(jira.connectionProgress().startedAt!).toBeGreaterThan(failedAt);
  });
  it('requires reconnect after a previously connected session closes', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(state(true)).mockResolvedValueOnce(state(false));
    const jira = new JiraClient(run);
    await jira.login();
    now.mockReturnValue(16_000);
    await expect(jira.boards()).rejects.toMatchObject({ statusCode: 401 });
    expect(run.mock.calls.map(call => call[0][0])).toEqual(['status', 'status']);
  });
  it('never overlaps browser commands across simultaneous reads', async () => {
    const gate = deferred<{ boards: never[] }>();
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(state(true)).mockImplementationOnce(() => gate.promise)
      .mockResolvedValueOnce({ sprints: [] });
    const jira = new JiraClient(run);
    const reads = Promise.all([jira.boards(), jira.sprints(42)]);
    try {
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
      expect(await jira.status()).toEqual(state(true));
      expect(run).toHaveBeenCalledTimes(2);
    } finally { gate.resolve({ boards: [] }); }
    expect(await reads).toEqual([{ boards: [] }, { sprints: [] }]);
    expect(run.mock.calls.map(call => call[0][0])).toEqual(['status', 'jira', 'jira']);
  });
  it('reuses the initial disconnected probe when Connect is clicked', async () => {
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(state(false)).mockResolvedValueOnce(state(true));
    const jira = new JiraClient(run);
    await jira.status();
    await jira.login();
    expect(run.mock.calls.map(call => call[0][0])).toEqual(['status', 'login']);
  });
  it('expires status 15 seconds after the probe finishes without extending it on reads', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const run = vi.fn<JiraRunner>().mockImplementationOnce(async () => { now.mockReturnValue(9_000); return state(true); })
      .mockResolvedValueOnce(state(false));
    const jira = new JiraClient(run);
    await jira.status();
    now.mockReturnValue(23_999);
    expect(await jira.status()).toEqual(state(true));
    expect(run).toHaveBeenCalledTimes(1);
    now.mockReturnValue(24_000);
    expect(await jira.status()).toEqual(state(false));
    expect(run).toHaveBeenCalledTimes(2);
  });
  it.each([401, 502, 504])('drops cached status immediately after request failure %i', async code => {
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(state(true))
      .mockRejectedValueOnce(new AppError(code, 'Session unavailable')).mockResolvedValueOnce(state(false));
    const jira = new JiraClient(run);
    await jira.login();
    await expect(jira.boards()).rejects.toMatchObject({ statusCode: code });
    expect(await jira.status()).toEqual(state(false));
    expect(run.mock.calls.map(call => call[0][0])).toEqual(['status', 'jira', 'status']);
  });
  it.each([401, 429, 502, 503, 504])('does not turn connection failure %i into empty comments or insights', async code => {
    for (const method of ['commentActivity', 'insights'] as const) {
      const run = vi.fn<JiraRunner>().mockResolvedValueOnce(state(true)).mockRejectedValueOnce(new AppError(code, 'Connection failed'));
      const jira = new JiraClient(run);
      await expect(method === 'commentActivity' ? jira.commentActivity(['ABC-1']) : jira.insights('ABC-1')).rejects.toMatchObject({ statusCode: code });
    }
  });
  it('reports inaccessible comments per issue while continuing other issues', async () => {
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(state(true)).mockRejectedValueOnce(new AppError(403, 'Permission denied'))
      .mockResolvedValueOnce(state(true)).mockResolvedValueOnce({ comments: [{ author: 'A', body: 'Hello', created: '2026-10-26' }] });
    const result = await new JiraClient(run).commentActivity(['ABC-1', 'ABC-2']);
    expect(result[0]).toMatchObject({ key: 'ABC-1', error: 'Permission denied' });
    expect(result[1]).toMatchObject({ key: 'ABC-2', count: 1 });
  });
});
describe('CLI error classification', () => {
  it.each([400, 401, 403, 404, 429, 503, 504])('preserves HTTP %i and its recovery hint', code => {
    const error = cliError(JSON.stringify({ error: 'GET /login: HTTP ' + code + ' - rejected', hint: 'Check permissions' }));
    expect(error.statusCode).toBe(code);
    expect(error.message).toContain('Check permissions');
  });
  it('does not treat a browser/login infrastructure failure as an expired session', () => {
    expect(cliError(JSON.stringify({ error: 'login: No Chromium-based browser found' })).statusCode).toBe(502);
  });
  it('skips progress lines and handles unstructured process failures', () => {
    expect(cliError('traceback\n' + JSON.stringify({ error: 'HTTP 403: denied' }) + '\n' + JSON.stringify({ info: 'login ended' })).statusCode).toBe(403);
    expect(cliError('Traceback')).toMatchObject({ statusCode: 502 });
  });
});
describe('connection HTTP endpoints', () => {
  it('manual checks bypass recent status and clear it when the probe fails', async () => {
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(state(true))
      .mockRejectedValueOnce(new AppError(502, 'Browser unavailable')).mockResolvedValueOnce(state(false));
    const app = createApp(new JiraClient(run));
    try {
      expect((await app.inject('/api/jira/status')).json()).toEqual(state(true));
      expect((await app.inject('/api/jira/status')).json()).toEqual(state(true));
      expect(run).toHaveBeenCalledTimes(1);
      expect((await app.inject('/api/jira/status?fresh=true')).statusCode).toBe(502);
      expect((await app.inject('/api/jira/status')).json()).toEqual(state(false));
      expect(run).toHaveBeenCalledTimes(3);
    } finally { await app.close(); }
  });
  it('accepts login immediately and keeps progress available across repeated requests', async () => {
    const gate = deferred<ReturnType<typeof state>>();
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(state(false)).mockImplementationOnce(() => gate.promise);
    const jira = new JiraClient(run);
    const app = createApp(jira);
    try {
      const response = await app.inject({ method: 'POST', url: '/api/jira/login' });
      expect(response.statusCode).toBe(202);
      const attempt = response.json().startedAt;
      const second = await app.inject({ method: 'POST', url: '/api/jira/login' });
      expect(second.json().startedAt).toBe(attempt);
      const progress = await app.inject('/api/jira/connection-progress');
      expect(progress.json().phase).toBe('browser');
      const completion = jira.login();
      gate.resolve(state(true));
      await completion;
      expect((await app.inject('/api/jira/connection-progress')).json().phase).toBe('connected');
      expect(run.mock.calls.filter(call => call[0][0] === 'login')).toHaveLength(1);
    } finally { gate.resolve(state(true)); await app.close(); }
  });
  it('exposes background login failures for the UI to recover', async () => {
    const gate = deferred<ReturnType<typeof state>>();
    const run = vi.fn<JiraRunner>().mockImplementationOnce(() => gate.promise).mockRejectedValueOnce(new AppError(502, 'Browser did not start'));
    const jira = new JiraClient(run);
    const app = createApp(jira);
    try {
      expect((await app.inject({ method: 'POST', url: '/api/jira/login' })).statusCode).toBe(202);
      const completion = expect(jira.login()).rejects.toMatchObject({ statusCode: 502 });
      gate.resolve(state(false));
      await completion;
      expect((await app.inject('/api/jira/connection-progress')).json()).toMatchObject({ phase: 'error', message: 'Browser did not start' });
    } finally { gate.resolve(state(false)); await app.close(); }
  });
  it.each(['/api/issues/bad-key', '/api/boards/0/sprints', '/api/issues/assigned?updatedDays=0', '/api/issues/comment-activity?keys=bad', '/api/boards?project=../invalid'])('rejects invalid input before using Jira: %s', async url => {
    const run = vi.fn<JiraRunner>();
    const app = createApp(new JiraClient(run));
    try {
      expect((await app.inject(url)).statusCode).toBe(400);
      expect(run).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it.each([401, 403, 404, 429, 502, 503, 504])('returns connection error %i to the browser', async code => {
    const run = vi.fn<JiraRunner>().mockRejectedValue(new AppError(code, 'Test failure'));
    const app = createApp(new JiraClient(run));
    try {
      const response = await app.inject('/api/jira/status');
      expect(response.statusCode).toBe(code);
      expect(response.json()).toEqual({ error: 'Test failure' });
    } finally { await app.close(); }
  });
});
