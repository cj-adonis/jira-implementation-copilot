import { describe, expect, it } from 'vitest';
import { normalizeTicket } from './jira.js';

describe('task metadata', () => {
  it('preserves dates, custom priorities, and workflow categories from Jira search fields', () => {
    const task = normalizeTicket({ key: 'TEST-1', fields: { summary: 'Task', status: { name: 'Verified', statusCategory: { key: 'done' } }, priority: { name: 'Urgent' }, duedate: '2026-10-25', assignee: { displayName: 'Jane' } } });
    expect(task).toMatchObject({ statusCategory: 'done', status: 'Verified', dueDate: '2026-10-25', priority: 'Urgent', assignee: 'Jane' });
  });
  it('only considers inward blocking links and ignores completed blockers', () => {
    const link = (key: string, category: string) => ({ type: { inward: 'is blocked by' }, inwardIssue: { key, fields: { status: { name: 'Custom', statusCategory: { key: category } } } } });
    const task = normalizeTicket({ key: 'TEST-1', fields: { issuelinks: [link('TEST-2', 'done'), link('TEST-3', 'indeterminate'), { type: { outward: 'blocks' }, outwardIssue: { key: 'TEST-4' } }] } });
    expect(task.blockedReasons).toEqual(['Blocked by TEST-3']);
  });
  it('recognizes blocked labels and avoids treating Unblocked as blocked', () => {
    expect(normalizeTicket({ key: 'TEST-1', status: 'Unblocked' }).blocked).toBe(false);
    expect(normalizeTicket({ key: 'TEST-1', labels: ['blocked'] }).blocked).toBe(true);
  });
});
