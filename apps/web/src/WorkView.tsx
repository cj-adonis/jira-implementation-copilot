import React, { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, readLocal, type Ticket } from './ui';
import { useJiraStatus } from './connection';
import { StatusEditor } from './StatusEditor';
import { Today } from './Today';
import { localDay, pinKey, sortTasks, groupTasks, type TaskSort } from './tasks';
import { TaskMeta } from './TaskMeta';
import { QuickActionsButton } from './QuickActions';
import { Icon } from './Icon';

type Filters = { text: string; status: string; project: string; priority: string; label: string; updatedDays: string };
type SavedView = { name: string; filters: Filters };
const emptyFilters: Filters = { text: '', status: '', project: '', priority: '', label: '', updatedDays: '' };
const serverFilters = (value: Filters) => [value.status, value.project, value.priority, value.label, value.updatedDays].join('|');

export function WorkView({ onSelect }: { onSelect: (key: string) => void }) {
  const [draft, setDraft] = useState<Filters>(() => readLocal('jira-copilot-filters-v2', emptyFilters));
  const [applied, setApplied] = useState<Filters>(draft);
  const connection = useJiraStatus();
  const connected = connection.connected;
  const [advanced, setAdvanced] = useState(false);
  const [page, setPage] = useState(0);
  const [layout, setLayout] = useState<'list' | 'board'>(() => readLocal<string>('jira-copilot-layout-v1', 'list') === 'board' ? 'board' : 'list');
  const [sort, setSort] = useState<TaskSort>(() => { const value = readLocal<string>('jira-copilot-sort-v1', 'updated'); return ['due', 'priority', 'summary'].includes(value) ? value as TaskSort : 'updated'; });
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Ticket[] | null>(null);
  const [pins, setPins] = useState<string[]>(() => {
    const stored = readLocal<unknown>(pinKey, []);
    return Array.isArray(stored) ? [...new Set(stored.filter((key): key is string => typeof key === 'string'))].slice(0, 5) : [];
  });
  const [pinError, setPinError] = useState('');
  const [today, setToday] = useState(localDay);
  useEffect(() => { const timer = window.setInterval(() => setToday(localDay()), 60_000); return () => window.clearInterval(timer); }, []);
  const togglePin = (key: string) => {
    if (!pins.includes(key) && pins.length >= 5) { setPinError('Your Today list has five pins. Unpin an issue to make room.'); return; }
    const next = pins.includes(key) ? pins.filter(item => item !== key) : [...pins, key];
    setPins(next); setPinError('');
    try { localStorage.setItem(pinKey, JSON.stringify(next)); } catch { setPinError('Pins will last for this session; browser storage is unavailable.'); }
  };
  useEffect(() => { setSelected([]); }, [draft.text, applied.status, applied.project, applied.priority, applied.label, applied.updatedDays]);
  const [views, setViews] = useState<SavedView[]>(() => readLocal('jira-copilot-views-v2', []));
  useEffect(() => { localStorage.setItem('jira-copilot-filters-v2', JSON.stringify(draft)); }, [draft]);
  const params = new URLSearchParams();
  if (applied.status) params.set('status', applied.status);
  if (applied.project) params.set('project', applied.project);
  if (applied.priority) params.set('priority', applied.priority);
  if (applied.label) params.set('label', applied.label);
  if (applied.updatedDays) params.set('updatedDays', applied.updatedDays);
  const query = useQuery({
    queryKey: ['assigned', applied.status, applied.project, applied.priority, applied.label, applied.updatedDays],
    queryFn: () => api<{ issues: Ticket[] }>('/api/issues/assigned' + (params.size ? '?' + params.toString() : '')),
    enabled: connected,
    // Keep the previous rows on screen while a new filter loads; they are dimmed below.
    placeholderData: keepPreviousData
  });
  const updating = query.isPlaceholderData ? ' is-updating' : '';
  const todayQuery = useQuery({ queryKey: ['assigned', '', '', '', '', ''], queryFn: () => api<{ issues: Ticket[] }>('/api/issues/assigned'), enabled: connected });
  const set = (name: keyof Filters, value: string) => setDraft(current => ({ ...current, [name]: value }));
  const dirty = serverFilters(draft) !== serverFilters(applied);
  const activeFilters = Object.entries(draft).filter(([, value]) => Boolean(value));
  const clearFilters = () => { setDraft({ ...emptyFilters }); setApplied({ ...emptyFilters }); setPage(0); setSelected([]); };
  const apply = () => {
    if (!dirty) query.refetch();
    else setApplied({ ...draft });
    setPage(0);
  };
  const saveView = () => {
    const name = window.prompt('Name this view');
    if (!name?.trim()) return;
    const next = [...views, { name: name.trim(), filters: { ...draft } }];
    setViews(next); localStorage.setItem('jira-copilot-views-v2', JSON.stringify(next));
  };
  const selectView = (view: SavedView) => { setDraft(view.filters); setApplied(view.filters); setPage(0); };
  const items = sortTasks((query.data?.issues ?? []).filter(ticket =>
    (ticket.key + ' ' + ticket.summary + ' ' + (ticket.status ?? '')).toLowerCase().includes(draft.text.toLowerCase())
  ), sort);
  const pageSize = 10, pageCount = Math.max(1, Math.ceil(items.length / pageSize)), current = Math.min(page, pageCount - 1);
  const visible = layout === 'board' ? items : items.slice(current * pageSize, current * pageSize + pageSize);
  const selection = items.filter(ticket => selected.includes(ticket.key));
  const allOnPage = visible.length > 0 && visible.every(ticket => selected.includes(ticket.key));
  const statuses = [...new Set([...(todayQuery.data?.issues ?? []).map(ticket => ticket.status).filter((status): status is string => Boolean(status)), ...(draft.status ? [draft.status] : [])])].sort();
  const priorities = [...new Set([...(todayQuery.data?.issues ?? []).map(ticket => ticket.priority).filter((priority): priority is string => Boolean(priority)), ...(draft.priority ? [draft.priority] : [])])].sort();
  const actions = (ticket: Ticket) => <><button className="button subtle small pin-button" aria-label={(pins.includes(ticket.key) ? 'Unpin ' : 'Pin ') + ticket.key} aria-pressed={pins.includes(ticket.key)} onClick={() => togglePin(ticket.key)}>{pins.includes(ticket.key) ? 'Unpin' : 'Pin'}</button><button className="button subtle small" aria-label={'Update status for ' + ticket.key} onClick={() => setEditing([ticket])}>Update status</button><QuickActionsButton target={ticket} /></>;
  return <>
    {connected && todayQuery.data && <Today issues={todayQuery.data.issues} pins={pins} onPin={togglePin} onSelect={onSelect} today={today} />}
    {pinError && <p className="field-note" role="status">{pinError}</p>}
    <section className="panel work-panel">
    {editing && <StatusEditor targets={editing} onClose={() => { setEditing(null); setSelected([]); }} />}
    <div className="panel-heading work-heading"><div className="section-heading"><span className="section-icon"><Icon name="work" /></span><div><p className="eyebrow">ASSIGNED TO YOU</p><h2>Issues {query.data && <span className="count-badge">{items.length}</span>}</h2><p className="muted">Search your work, open an issue, or select issues to update their status.</p></div></div><button className="button subtle" onClick={() => { void query.refetch(); if (params.size) void todayQuery.refetch(); }} disabled={!connected || query.isFetching || todayQuery.isFetching}><Icon name="refresh" />{query.isFetching || todayQuery.isFetching ? 'Loading…' : 'Refresh issues'}</button></div>
    <div className="filter-bar">
      <label className="search-field"><Icon name="search" /><span className="visually-hidden">Filter tickets</span><input type="search" value={draft.text} onChange={event => { set('text', event.target.value); setPage(0); }} placeholder="Search key, summary, or status" /></label>
      <select aria-label="Status filter" value={draft.status} onChange={event => set('status', event.target.value)}>
        <option value="">All statuses</option>{statuses.map(status => <option key={status}>{status}</option>)}
      </select>
      <button className="button subtle" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced} aria-controls="advanced-filters">{advanced ? 'Fewer filters' : 'More filters'}</button>
      {dirty && <button className="button primary" onClick={apply} disabled={!connected || query.isFetching}>Apply filters</button>}
    </div>
    <div className="work-controls"><div className="layout-toggle" role="group" aria-label="Issue layout">{(['list', 'board'] as const).map(value => <button className={'button small ' + (layout === value ? 'primary' : 'subtle')} aria-pressed={layout === value} key={value} onClick={() => { setLayout(value); try { localStorage.setItem('jira-copilot-layout-v1', JSON.stringify(value)); } catch {} }}><Icon name={value === 'list' ? 'list' : 'board'} />{value === 'list' ? 'List' : 'Board'}</button>)}</div><label>Sort by <select aria-label="Sort issues" value={sort} onChange={event => { const value = event.target.value as TaskSort; setSort(value); setPage(0); try { localStorage.setItem('jira-copilot-sort-v1', JSON.stringify(value)); } catch {} }}><option value="updated">Recently updated</option><option value="due">Due date</option><option value="priority">Priority</option><option value="summary">Summary</option></select></label></div>
    {advanced && <div id="advanced-filters" className="advanced-filters">
      <label>Project key<input value={draft.project} onChange={event => set('project', event.target.value.toUpperCase())} placeholder="Example: CBCC" /></label>
      <label>Label<input value={draft.label} onChange={event => set('label', event.target.value)} placeholder="Any label" /></label>
      <label>Priority<select value={draft.priority} onChange={event => set('priority', event.target.value)}><option value="">Any priority</option>{priorities.map(priority => <option key={priority}>{priority}</option>)}</select></label>
      <label>Updated<select value={draft.updatedDays} onChange={event => set('updatedDays', event.target.value)}><option value="">Any time</option><option value="7">Past 7 days</option><option value="30">Past 30 days</option><option value="90">Past 90 days</option></select></label>
      <button className="button subtle" onClick={saveView}>Save this view</button>
    </div>}
    {dirty && <p className="filter-note" role="status">Filters changed. Select Apply filters to update your results.</p>}
    {activeFilters.length > 0 && <div className="filter-summary" aria-label="Current filters">{activeFilters.map(([name, value]) => <span className="filter-chip" key={name}>{name === 'updatedDays' ? `Updated: past ${value} days` : `${name === 'text' ? 'Search' : name.charAt(0).toUpperCase() + name.slice(1)}: ${value}`}</span>)}<button className="button subtle small" onClick={clearFilters}>Clear filters</button></div>}
    {views.length > 0 && <div className="saved-views"><span>Saved views</span>{views.map((view, index) => <span className="saved-view" key={view.name + index}><button onClick={() => selectView(view)}>{view.name}</button><button aria-label={'Remove ' + view.name} onClick={() => { const next = views.filter((_, i) => i !== index); setViews(next); localStorage.setItem('jira-copilot-views-v2', JSON.stringify(next)); }}>×</button></span>)}</div>}
    {!connected && <div className="empty-state"><strong>Connect Jira to see your issues</strong><p>Sign in above, then your assigned issues will load here automatically.</p></div>}
    {query.isLoading && <div className="empty-state"><p>Loading your queue…</p></div>}
    {query.error && connected && <div className="inline-error" role="alert"><strong>Could not load issues</strong><p>{query.error.message}</p><button className="button subtle small" onClick={() => query.refetch()}>Try again</button></div>}
    {query.data && connected && <>
      <div className="batch-toolbar"><label><input type="checkbox" checked={allOnPage} disabled={!visible.length} onChange={event => setSelected(previous => event.target.checked ? [...new Set([...previous, ...visible.map(ticket => ticket.key)])] : previous.filter(key => !visible.some(ticket => ticket.key === key)))} /> {layout === 'board' ? 'Select all shown' : 'Select this page'}</label>
        <span>{selection.length} selected</span><button className="button primary small" disabled={!selection.length} onClick={() => setEditing(selection)}>Update selected</button>
        {selection.length > 0 && <button className="button subtle small" onClick={() => setSelected([])}>Clear selection</button>}</div>
      {layout === 'list' ? <div className={'ticket-table' + updating} aria-busy={query.isPlaceholderData}>{visible.map(ticket => <div className="selectable-ticket" key={ticket.key}>
        <input type="checkbox" aria-label={'Select ' + ticket.key} checked={selected.includes(ticket.key)} onChange={event => setSelected(previous => event.target.checked ? [...previous, ticket.key] : previous.filter(key => key !== ticket.key))} />
        <button className="ticket-row" onClick={() => onSelect(ticket.key)}>
          <span className="ticket-key">{ticket.key}</span><span className="ticket-content"><span className="ticket-summary">{ticket.summary}</span><TaskMeta task={ticket} today={today} /></span><span className="status-tag">{ticket.status ?? 'No status'}</span><span className="row-arrow">&rarr;</span>
        </button><div className="task-actions">{actions(ticket)}</div>
      </div>)}</div> : <><p className="field-note">Grouped by your Jira workflow. Use Update status to move an issue to its next step.</p><div className={'task-board' + updating} aria-busy={query.isPlaceholderData} aria-label="Assigned issue board">{groupTasks(items).map(group => <section className="task-column" key={group.status} aria-label={group.status}><div className="column-heading"><h3>{group.status}</h3><span className="count-badge">{group.issues.length}</span></div>{group.issues.map(ticket => <article className="task-card" key={ticket.key}>
        <div className="card-heading"><input type="checkbox" aria-label={'Select ' + ticket.key} checked={selected.includes(ticket.key)} onChange={event => setSelected(previous => event.target.checked ? [...previous, ticket.key] : previous.filter(key => key !== ticket.key))} /><span className="ticket-key">{ticket.key}</span></div>
        <button className="board-open" onClick={() => onSelect(ticket.key)}>{ticket.summary}</button><TaskMeta task={ticket} today={today} /><div className="task-actions">{actions(ticket)}</div>
      </article>)}</section>)}</div></>}
      {items.length === 0 && <div className="empty-state"><strong>{activeFilters.length ? 'No issues match your filters' : 'You’re all caught up'}</strong><p>{activeFilters.length ? 'Try a different search or clear your filters.' : 'Issues assigned to you will appear here.'}</p>{activeFilters.length > 0 && <button className="button subtle small" onClick={clearFilters}>Clear filters</button>}</div>}
      <div className="table-footer"><span aria-live="polite">{layout === 'board' ? items.length : items.length ? `${current * pageSize + 1}–${Math.min((current + 1) * pageSize, items.length)} of ${items.length}` : '0'} issues</span>{layout === 'list' && pageCount > 1 && <div className="pager"><button className="button subtle small" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button><span>{current + 1} / {pageCount}</span><button className="button subtle small" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>Next</button></div>}</div>
    </>}
  </section></>;
}
