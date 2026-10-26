import type { Ticket } from './ui';

export const pinKey = 'jira-copilot-pinned-v1';
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function isDone(task: Pick<Ticket, 'status' | 'statusCategory'>) {
  return task.statusCategory === 'done' || (!task.statusCategory && /^(done|closed|resolved|cancelled|canceled)$/i.test(task.status ?? ''));
}
export function dueState(task: Pick<Ticket, 'dueDate' | 'status' | 'statusCategory'>, today = localDay()): 'overdue' | 'today' | 'upcoming' | null {
  if (!task.dueDate || isDone(task) || !/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)) return null;
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  const end = new Date(today + 'T12:00:00');
  end.setDate(end.getDate() + 7);
  return task.dueDate <= localDay(end) ? 'upcoming' : null;
}
export function dueLabel(task: Pick<Ticket, 'dueDate' | 'status' | 'statusCategory'>, today = localDay()) {
  if (!task.dueDate) return 'No due date';
  const date = new Date(task.dueDate + 'T12:00:00');
  const label = Number.isNaN(date.getTime()) ? task.dueDate : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const state = dueState(task, today);
  return state === 'overdue' ? `Overdue · ${label}` : state === 'today' ? 'Due today' : `Due ${label}`;
}
export type TaskSort = 'updated' | 'due' | 'priority' | 'summary';
export function sortTasks(tasks: Ticket[], sort: TaskSort) {
  const ranks: Record<string, number> = { highest: 0, urgent: 0, critical: 0, blocker: 0, high: 1, major: 1, medium: 2, normal: 2, low: 3, minor: 3, lowest: 4, trivial: 4 };
  return tasks.slice().sort((a, b) => {
    if (sort === 'due') return (!a.dueDate && !b.dueDate ? 0 : !a.dueDate ? 1 : !b.dueDate ? -1 : a.dueDate.localeCompare(b.dueDate)) || a.key.localeCompare(b.key, undefined, { numeric: true });
    if (sort === 'priority') return (ranks[a.priority?.toLowerCase() ?? ''] ?? 99) - (ranks[b.priority?.toLowerCase() ?? ''] ?? 99) || (a.priority ?? '').localeCompare(b.priority ?? '');
    if (sort === 'summary') return a.summary.localeCompare(b.summary);
    return (Date.parse(b.updated ?? '') || 0) - (Date.parse(a.updated ?? '') || 0);
  });
}
export function groupTasks(tasks: Ticket[]) {
  const groups = new Map<string, Ticket[]>();
  for (const task of tasks) { const name = task.status ?? 'No status'; groups.set(name, [...(groups.get(name) ?? []), task]); }
  const rank = (list: Ticket[]) => list[0]?.statusCategory === 'new' ? 0 : list[0]?.statusCategory === 'done' ? 2 : 1;
  return [...groups.entries()].sort((a, b) => rank(a[1]) - rank(b[1])).map(([status, issues]) => ({ status, issues }));
}
