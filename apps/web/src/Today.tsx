import React from 'react';
import type { Ticket } from './ui';
import { dueLabel, dueState, isDone } from './tasks';
import { Icon } from './Icon';

export function Today({ issues, pins, onPin, onSelect, today }: {
  issues: Ticket[]; pins: string[]; onPin: (key: string) => void; onSelect: (key: string) => void; today: string;
}) {
  const pinned = pins.map(key => issues.find(issue => issue.key === key)).filter((issue): issue is Ticket => Boolean(issue));
  const attention = issues.filter(issue => !pins.includes(issue.key) && dueState(issue, today))
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const focus = [...pinned, ...attention].slice(0, 5);
  const otherDeadlines = attention.filter(issue => !focus.some(item => item.key === issue.key));
  const overdue = issues.filter(issue => dueState(issue, today) === 'overdue').length;
  const dueToday = issues.filter(issue => dueState(issue, today) === 'today').length;
  return <section className="today-panel" aria-label="Today">
    <div className="panel-heading"><div className="section-heading"><span className="section-icon"><Icon name="sparkles" /></span><div><p className="eyebrow">YOUR DAILY FOCUS</p><h2>Today</h2><p className="muted">Pin your priorities. Due and overdue work appears here automatically.</p></div></div><span className="local-note"><Icon name="pin" />Pins stay on this device</span></div>
    <div className="today-counts" role="group" aria-label="Today overview"><div className="today-stat"><span className="stat-icon"><Icon name="pin" /></span><span className="stat-copy"><strong>{pins.length}</strong><span>pinned</span></span></div><div className="today-stat due-stat"><span className="stat-icon"><Icon name="calendar" /></span><span className="stat-copy"><strong>{dueToday}</strong><span>due today</span></span></div><div className={'today-stat' + (overdue ? ' overdue-text' : '')}><span className="stat-icon"><Icon name="alert" /></span><span className="stat-copy"><strong>{overdue}</strong><span>overdue</span></span></div></div>
    {focus.length ? <div className="today-list">{focus.map(issue => <div className={'today-task' + (isDone(issue) ? ' is-done' : '')} key={issue.key}>
      <button className="today-open" onClick={() => onSelect(issue.key)}><strong>{issue.key}</strong><span>{issue.summary}</span></button>
      <span className={'due-tag ' + (dueState(issue, today) ?? '')}>{dueLabel(issue, today)}</span>
      <button className="button subtle small pin-button" aria-label={(pins.includes(issue.key) ? 'Unpin ' : 'Pin ') + issue.key} aria-pressed={pins.includes(issue.key)} onClick={() => onPin(issue.key)}>{pins.includes(issue.key) ? 'Unpin' : 'Pin'}</button>
    </div>)}</div> : <p className="muted today-empty">Pin up to five issues from your list to plan your day.</p>}
    {otherDeadlines.length > 0 && <details className="today-deadlines"><summary>{otherDeadlines.length} more issues due soon or overdue</summary><div className="today-list">{otherDeadlines.map(issue => <div className="today-task" key={issue.key}><button className="today-open" onClick={() => onSelect(issue.key)}><strong>{issue.key}</strong><span>{issue.summary}</span></button><span className={'due-tag ' + (dueState(issue, today) ?? '')}>{dueLabel(issue, today)}</span></div>)}</div></details>}
    {pins.filter(key => !issues.some(issue => issue.key === key)).map(key => <p className="muted" key={key}>{key} is no longer in your assigned issues. <button className="button subtle small" onClick={() => onPin(key)} aria-label={'Unpin ' + key}>Unpin</button></p>)}
  </section>;
}
