import React from 'react';
import type { Ticket } from './ui';
import { dueLabel, dueState } from './tasks';
import { Icon } from './Icon';

export function TaskMeta({ task, today }: { task: Pick<Ticket, 'dueDate' | 'status' | 'statusCategory' | 'priority' | 'blocked' | 'blockedReasons'>; today?: string }) {
  return <span className="task-meta"><span className="priority-tag" data-priority={task.priority?.toLowerCase()}>{task.priority ?? 'No priority'}</span><span className={'due-tag ' + (dueState(task, today) ?? '')}><Icon name="calendar" />{dueLabel(task, today)}</span>{task.blocked && <span className="blocked-tag" title={task.blockedReasons?.join('\n')}><Icon name="alert" />Blocked{task.blockedReasons?.length ? ` · ${task.blockedReasons.join('; ')}` : ''}</span>}</span>;
}
