import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ exec: vi.fn(), access: vi.fn(), readFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.exec }));
vi.mock('node:fs/promises', () => ({ access: mocks.access, readFile: mocks.readFile }));
import { runJiraCli } from './jira.js';

function processResult(error: object | null, stdout = '', stderr = '', chunks: string[] = []) {
  mocks.exec.mockImplementation((_exe, _args, _options, callback) => {
    const stream = new EventEmitter();
    queueMicrotask(() => {
      for (const chunk of chunks) stream.emit('data', Buffer.from(chunk));
      callback(error, stdout, stderr);
    });
    return { stderr: stream };
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue(undefined);
  vi.stubEnv('MANAGING_JIRA_SKILL_PATH', 'C:/test/skill');
  vi.stubEnv('MANAGING_JIRA_PYTHON', 'python');
});
afterEach(() => vi.unstubAllEnvs());
describe('Jira CLI process boundary', () => {
  it('parses successful CLI JSON and passes arguments without a shell', async () => {
    processResult(null, '{"sites":[]}');
    expect(await runJiraCli(['status', '--service', 'jira', '--site', 'mx'])).toEqual({ sites: [] });
    const [exe, args, options] = mocks.exec.mock.calls[0];
    expect(exe).toBe('python');
    expect(args.slice(1)).toEqual(['status', '--service', 'jira', '--site', 'mx']);
    expect(options).toMatchObject({ windowsHide: true, timeout: 30000 });
    expect(options.shell).toBeUndefined();
  });
  it('routes login through the immediate-navigation adapter with the installed CLI path', async () => {
    processResult(null, '{}');
    await runJiraCli(['login', '--service', 'jira', '--site', 'mx', '--headed']);
    const args = mocks.exec.mock.calls[0][1];
    expect(args[0].replaceAll('\\', '/')).toMatch(/scripts\/jira-login\.py$/);
    expect(args[1].replaceAll('\\', '/')).toBe('C:/test/skill/scripts/atlassian.py');
    expect(args.slice(2)).toEqual(['login', '--service', 'jira', '--site', 'mx', '--headed']);
  });
  it.each(['search', 'get-issue'])('preserves task fields through the workspace adapter for %s', async command => {
    processResult(null, '{}');
    await runJiraCli(['jira', command, '--site', 'mx']);
    const args = mocks.exec.mock.calls[0][1];
    expect(args[0].replaceAll('\\', '/')).toMatch(/scripts\/jira-workspace\.py$/);
    expect(args[1].replaceAll('\\', '/')).toBe('C:/test/skill/scripts/atlassian.py');
    expect(args.slice(2)).toEqual(['jira', command, '--site', 'mx']);
  });
  it('does not silently use another skill when the configured directory is missing', async () => {
    mocks.access.mockRejectedValue(new Error('Missing'));
    await expect(runJiraCli(['status'])).rejects.toMatchObject({ statusCode: 503 });
    expect(mocks.access).toHaveBeenCalledTimes(1);
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  it('reports missing Python with a setup hint', async () => {
    processResult({ code: 'ENOENT' });
    await expect(runJiraCli(['status'])).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('MANAGING_JIRA_PYTHON') });
  });
  it.each([
    ['status', 'Checking the Jira browser timed out', 30000],
    ['login', 'Jira SSO timed out', 420000],
    ['jira', 'The Jira request timed out', 420000]
  ])('distinguishes %s process timeouts', async (command, message, timeout) => {
    processResult({ killed: true });
    await expect(runJiraCli([String(command)])).rejects.toMatchObject({ statusCode: 504, message: expect.stringContaining(String(message)) });
    expect(mocks.exec.mock.calls[0][2].timeout).toBe(timeout);
  });
  it('rejects successful exit with invalid JSON', async () => {
    processResult(null, '<html>SSO</html>');
    await expect(runJiraCli(['login'])).rejects.toMatchObject({ statusCode: 502, message: expect.stringContaining('invalid response') });
  });
  it('preserves structured process errors after progress output', async () => {
    processResult({ code: 1 }, '', '{"info":"checking"}\n{"error":"HTTP 403: denied","hint":"Check project access"}');
    await expect(runJiraCli(['jira'])).rejects.toMatchObject({ statusCode: 403, message: expect.stringContaining('Check project access') });
  });
  it('reads progress JSON split across stderr chunks', async () => {
    processResult(null, '{}', '', ['{"info":"waiting for ', 'SSO"}\nnoise\n{"info":"done"}\n']);
    const onInfo = vi.fn();
    await runJiraCli(['login'], onInfo);
    expect(onInfo.mock.calls).toEqual([['waiting for SSO'], ['done']]);
  });
  it('selects Python 3 when using the Windows py launcher', async () => {
    vi.stubEnv('MANAGING_JIRA_PYTHON', 'py');
    processResult(null, '{}');
    await runJiraCli(['status']);
    expect(mocks.exec.mock.calls[0][1][0]).toBe('-3');
  });
});
