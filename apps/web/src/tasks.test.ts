import { describe, expect, it } from 'vitest';
import type { Ticket } from './ui';
import { dueState, dueLabel, localDay, sortTasks, groupTasks } from './tasks';

const task = (dueDate: string | null, statusCategory = 'indeterminate'): Ticket => ({ key: 'TEST-1', summary: 'Task', status: 'Review', statusCategory, dueDate, priority: 'High', assignee: null, updated: null, blocked: false, blockedReasons: [] });
describe('daily task planning', () => {
  it('uses calendar dates in the local timezone', () => {
    expect(localDay(new Date(2026, 9, 26, 0, 1))).toBe('2026-10-26');
  });
  it('separates overdue, today, upcoming, and later tasks', () => {
    expect(dueState(task('2026-10-25'), '2026-10-26')).toBe('overdue');
    expect(dueState(task('2026-10-26'), '2026-10-26')).toBe('today');
    expect(dueState(task('2026-11-02'), '2026-10-26')).toBe('upcoming');
    expect(dueState(task('2026-11-03'), '2026-10-26')).toBeNull();
    expect(dueState(task(null), '2026-10-26')).toBeNull();
  });
  it('never marks completed work overdue, including custom workflow statuses', () => {
    expect(dueState(task('2026-10-25', 'done'), '2026-10-26')).toBeNull();
    expect(dueLabel(task('2026-10-26'), '2026-10-26')).toBe('Due today');
  });
  it('sorts due dates with undated tasks last and keeps the source order intact', () => {
    const source = [task(null), task('2026-10-27'), task('2026-10-25')];
    expect(sortTasks(source, 'due').map(item => item.dueDate)).toEqual(['2026-10-25', '2026-10-27', null]);
    expect(source[0].dueDate).toBeNull();
  });
  it('sorts standard priorities while preserving custom priorities', () => {
    expect(sortTasks([{ ...task(null), priority: null }, { ...task(null), priority: 'Low' }, { ...task(null), priority: 'Critical' }], 'priority').map(item => item.priority)).toEqual(['Critical', 'Low', null]);
  });
  it('groups by actual workflow names in category order without inventing statuses', () => {
    const groups = groupTasks([{ ...task(null, 'done'), status: 'Verified' }, { ...task(null), status: 'QA Review' }, { ...task(null, 'new'), status: 'Ready for dev' }]);
    expect(groups.map(group => group.status)).toEqual(['Ready for dev', 'QA Review', 'Verified']);
  });
});
