import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { AppError, JiraClient, type JiraRunner } from './jira.js';

const state = { sites: [{ service: 'jira', site: 'mx', logged_in: true }] };
const choices = { transitions: [{ id: '31', name: 'Start work', to: 'In Progress' }] };
const updates = [{ key: 'TEST-1', transitionId: '31' }, { key: 'TEST-2', transitionId: '31' }];
function fixture(handler?: JiraRunner) {
  return vi.fn<JiraRunner>(async args => {
    if (handler) { const result = await handler(args); if (result !== undefined) return result; }
    if (args[0] === 'status') return state;
    if (args[1] === 'get-transitions') return choices;
    if (args[1] === 'transition-issue') return { transitioned: true };
    throw new Error('Unexpected command');
  });
}

describe('status updates', () => {
  it('loads workflow choices and writes a single normalized key on MX', async () => {
    const run = fixture();
    const app = createApp(new JiraClient(run));
    try {
      expect((await app.inject('/api/issues/test-1/transitions')).json()).toEqual(choices);
      const result = await app.inject({ method: 'POST', url: '/api/issues/test-1/status', payload: { transitionId: '31' } });
      expect(result.statusCode).toBe(200);
      expect(result.json().results).toEqual([{ key: 'TEST-1', outcome: 'updated', message: 'Updated to In Progress.' }]);
      expect(run).toHaveBeenCalledWith(['jira', 'transition-issue', '--site', 'mx', '--key', 'TEST-1', '--transition-id', '31']);
    } finally { await app.close(); }
  });
  it('uses each issue transition ID and serializes concurrent batches', async () => {
    let active = 0;
    const run = fixture(async args => {
      active++;
      expect(active).toBe(1);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      if (args[1] === 'get-transitions' && args.includes('TEST-2')) return { transitions: [{ id: '42', name: 'Begin', to: 'In Progress' }] };
    });
    const jira = new JiraClient(run);
    const result = await Promise.all([jira.updateStatuses([updates[0], { key: 'TEST-2', transitionId: '42' }]), jira.updateStatuses([{ key: 'TEST-3', transitionId: '31' }])]);
    expect(result.flatMap(batch => batch.results).every(item => item.outcome === 'updated')).toBe(true);
    expect(run.mock.calls.filter(([args]) => args[1] === 'transition-issue').map(([args]) => args.slice(-3))).toEqual([
      ['TEST-1', '--transition-id', '31'], ['TEST-2', '--transition-id', '42'], ['TEST-3', '--transition-id', '31']
    ]);
  });
  it.each([{}, { updates: [] }, { updates: [updates[0], updates[0]] }, { updates: [{ key: 'bad/key', transitionId: '31' }] }, { updates: [{ key: 'TEST-1', transitionId: '--help' }] }, { updates: Array.from({ length: 51 }, (_, i) => ({ key: 'TEST-' + i, transitionId: '31' })) }])('rejects invalid batches before any CLI call: %j', async payload => {
    const run = fixture();
    const app = createApp(new JiraClient(run));
    try {
      expect((await app.inject({ method: 'POST', url: '/api/issues/status', payload })).statusCode).toBe(400);
      expect(run).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('reports stale choices without writing and continues valid items', async () => {
    const run = fixture(async args => args[1] === 'get-transitions' && args.includes('TEST-1') ? { transitions: [] } : undefined);
    const result = await new JiraClient(run).updateStatuses(updates);
    expect(result.results.map(item => item.outcome)).toEqual(['failed', 'updated']);
    expect(run.mock.calls.filter(([args]) => args[1] === 'transition-issue')).toHaveLength(1);
  });
  it.each([400, 403])('keeps per-issue HTTP %i errors while continuing the batch', async code => {
    const run = fixture(async args => { if (args[1] === 'transition-issue' && args.includes('TEST-1')) throw new AppError(code, 'Required field or permission missing'); });
    const result = await new JiraClient(run).updateStatuses(updates);
    expect(result.results.map(item => item.outcome)).toEqual(['failed', 'updated']);
    expect(result.results[0].message).toContain('Required field');
  });
  it('stops after session expiry and never launches login or replays success', async () => {
    let probes = 0;
    const run = fixture(async args => args[0] === 'status' && ++probes === 2 ? { sites: [{ service: 'jira', site: 'mx', logged_in: false }] } : undefined);
    const result = await new JiraClient(run).updateStatuses([...updates, { key: 'TEST-3', transitionId: '31' }]);
    expect(result.results.map(item => item.outcome)).toEqual(['updated', 'failed', 'skipped']);
    expect(run.mock.calls.filter(([args]) => args[1] === 'transition-issue')).toHaveLength(1);
    expect(run.mock.calls.some(([args]) => args[0] === 'login')).toBe(false);
  });
  it.each([502, 504])('marks write HTTP %i as uncertain and stops without retrying', async code => {
    const run = fixture(async args => { if (args[1] === 'transition-issue') throw new AppError(code, 'Connection lost'); });
    const result = await new JiraClient(run).updateStatuses(updates);
    expect(result.results.map(item => item.outcome)).toEqual(['unknown', 'skipped']);
    expect(run.mock.calls.filter(([args]) => args[1] === 'transition-issue')).toHaveLength(1);
  });
  it('does not mark an unreadable write response as success', async () => {
    const run = fixture(async args => args[1] === 'transition-issue' ? {} : undefined);
    expect((await new JiraClient(run).updateStatuses(updates)).results.map(item => item.outcome)).toEqual(['unknown', 'skipped']);
  });
  it('does not write when choices are malformed', async () => {
    const run = fixture(async args => args[1] === 'get-transitions' ? {} : undefined);
    expect((await new JiraClient(run).updateStatuses(updates)).results.map(item => item.outcome)).toEqual(['failed', 'skipped']);
    expect(run.mock.calls.some(([args]) => args[1] === 'transition-issue')).toBe(false);
  });
});
