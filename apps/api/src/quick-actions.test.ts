import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { AppError, JiraClient, type JiraRunner } from './jira.js';

const state = { sites: [{ service: 'jira', site: 'mx', logged_in: true }] };
const metadata = { priority: { name: 'Medium' }, duedate: '2026-10-26', editmeta: { fields: { priority: { allowedValues: [{ id: '1', name: 'Urgent' }, { id: '3', name: 'Medium' }] }, duedate: {} } } };
function fixture(handler?: JiraRunner) {
  return vi.fn<JiraRunner>(async args => {
    if (handler) { const result = await handler(args); if (result !== undefined) return result; }
    if (args[0] === 'status') return state;
    if (args[1] === 'get-issue') return metadata;
    if (args[1] === 'add-comment') return { id: '123' };
    if (args[1] === 'update-issue') return { updated: true };
    throw new Error('Unexpected command');
  });
}
describe('reviewed quick actions', () => {
  it.each([
    { action: 'comment', body: '' , confirmed: true },
    { action: 'comment', body: 'Unconfirmed' },
    { action: 'priority', priorityId: '../bad', confirmed: true },
    { action: 'dueDate', dueDate: '2026-02-30', confirmed: true },
    { action: 'dueDate', dueDate: '26/10/2026', confirmed: true },
    { action: 'priority', priorityId: '1', confirmed: true, assignee: 'somebody' }
  ])('rejects invalid or unconfirmed changes before touching Jira: %j', async payload => {
    const run = fixture(), app = createApp(new JiraClient(run));
    try {
      expect((await app.inject({ method: 'POST', url: '/api/issues/TEST-1/quick-action', payload })).statusCode).toBe(400);
      expect(run).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('adds comments once on MX with their literal text passed without a shell', async () => {
    const run = fixture(), jira = new JiraClient(run);
    expect(await jira.quickAction('test-1', { action: 'comment', body: 'Progress: $() and `text`', confirmed: true })).toMatchObject({ outcome: 'updated' });
    expect(run).toHaveBeenCalledWith(['jira', 'add-comment', '--site', 'mx', '--key', 'TEST-1', '--body', 'Progress: $() and `text`']);
  });
  it('uses the issue editable priorities and revalidates before writing', async () => {
    const run = fixture(), jira = new JiraClient(run);
    expect((await jira.editOptions('TEST-1')).priorities[0]).toEqual({ id: '1', name: 'Urgent' });
    expect(await jira.quickAction('TEST-1', { action: 'priority', priorityId: '1', confirmed: true })).toMatchObject({ outcome: 'updated' });
    expect(run).toHaveBeenCalledWith(['jira', 'update-issue', '--site', 'mx', '--key', 'TEST-1', '--fields', '{"priority":{"id":"1"}}']);
  });
  it('refuses a stale priority without writing', async () => {
    const run = fixture();
    expect(await new JiraClient(run).quickAction('TEST-1', { action: 'priority', priorityId: '9', confirmed: true })).toMatchObject({ outcome: 'failed' });
    expect(run.mock.calls.some(([args]) => args[1] === 'update-issue')).toBe(false);
  });
  it('supports clearing due dates and respects fields that cannot be edited', async () => {
    const run = fixture();
    expect(await new JiraClient(run).quickAction('TEST-1', { action: 'dueDate', dueDate: null, confirmed: true })).toMatchObject({ outcome: 'updated' });
    expect(run).toHaveBeenCalledWith(['jira', 'update-issue', '--site', 'mx', '--key', 'TEST-1', '--fields', '{"duedate":null}']);
    const restricted = fixture(async args => args[1] === 'get-issue' ? { editmeta: { fields: {} } } : undefined);
    expect(await new JiraClient(restricted).quickAction('TEST-1', { action: 'dueDate', dueDate: '2026-11-01', confirmed: true })).toMatchObject({ outcome: 'failed' });
    expect(restricted.mock.calls.some(([args]) => args[1] === 'update-issue')).toBe(false);
  });
  it('does not retry comments after an uncertain write', async () => {
    const run = fixture(async args => { if (args[1] === 'add-comment') throw new AppError(504, 'Lost connection'); });
    expect(await new JiraClient(run).quickAction('TEST-1', { action: 'comment', body: 'Progress', confirmed: true })).toMatchObject({ outcome: 'unknown', message: expect.stringContaining('Check the issue') });
    expect(run.mock.calls.filter(([args]) => args[1] === 'add-comment')).toHaveLength(1);
  });
  it('never launches login or writes after session expiry', async () => {
    const run = fixture(async args => args[0] === 'status' ? { sites: [{ service: 'jira', site: 'mx', logged_in: false }] } : undefined);
    await expect(new JiraClient(run).quickAction('TEST-1', { action: 'comment', body: 'Progress', confirmed: true })).rejects.toMatchObject({ statusCode: 401 });
    expect(run.mock.calls).toHaveLength(1);
  });
});
