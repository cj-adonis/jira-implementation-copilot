import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, dateText } from './ui';
import { type ConnectionProgress } from '@jira-copilot/shared';
import { isConnecting, progressKey, statusKey, refreshJiraData, useJiraProgress, useJiraStatus } from './connection';
import { ConnectionLoading } from './ConnectionLoading';
import { Icon } from './Icon';

type Insights = {
  dates: { duedate?: string; resolutiondate?: string; status_changes?: { at: string; from: string; to: string }[] } | null;
  watchers: { count?: number; watchers?: { displayName: string }[] } | null;
  worklog: { worklogs?: { id: string; author: string; timeSpent: string; comment?: string }[] } | null;
  transitions: { transitions?: { id: string; name: string; to: string }[] } | null;
};
const seenKey = 'jira-copilot-comment-seen';
export const readCommentSeen = (): Record<string, string> => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(seenKey) ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch { return {}; }
};
export function markCommentsSeen(key: string, timestamp?: string | null) {
  if (!timestamp) return;
  const next = readCommentSeen(); next[key] = timestamp;
  try { localStorage.setItem(seenKey, JSON.stringify(next)); } catch { /* Read state is optional. */ }
}

export function JiraConnection() {
  const client = useQueryClient();
  const progress = useJiraProgress();
  const status = useJiraStatus();
  const connect = useMutation({
    mutationFn: () => api<ConnectionProgress>('/api/jira/login', { method: 'POST' }),
    onSuccess: value => { client.setQueryData(progressKey, value); },
    onSettled: () => { void client.invalidateQueries({ queryKey: progressKey }); }
  });
  const completedAttempt = useRef<number | null>(null);
  useEffect(() => {
    const value = progress.data;
    if (!value?.startedAt || isConnecting(value) || completedAttempt.current === value.startedAt) return;
    completedAttempt.current = value.startedAt;
    void client.invalidateQueries({ queryKey: statusKey });
  }, [progress.data, client]);
  const connected = status.connected;
  const wasConnected = useRef(false);
  useEffect(() => {
    if (connected && !wasConnected.current) void refreshJiraData(client);
    wasConnected.current = connected;
  }, [connected, client]);
  const waiting = connect.isPending || isConnecting(progress.data);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!waiting) { setElapsed(0); return; }
    const started = progress.data?.startedAt ?? Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1_000);
    return () => window.clearInterval(timer);
  }, [waiting, progress.data?.startedAt]);
  const checking = !waiting && status.preparing;
  const showHelp = !connected && (connect.isError || progress.data?.phase === 'error' || (waiting && elapsed >= 20));
  const help = showHelp && <div className="connection-help"><strong>What should I do in Chrome?</strong><p>If you see Samsung Sign In, complete it there. If Chrome stays on New Tab, open this address in that same window:</p><div><code>https://jira-mx.sec.samsung.net/login.jsp</code><button className="button subtle small" onClick={() => navigator.clipboard.writeText('https://jira-mx.sec.samsung.net/login.jsp')}>Copy</button></div><p>Already signed in? Use Check connection after this attempt finishes.</p></div>;
  if (!connected && (waiting || checking)) return <ConnectionLoading phase={waiting && isConnecting(progress.data) ? progress.data!.phase : 'checking'} message={progress.data?.message} help={<>{progress.error && <div className="inline-error" role="alert"><strong>Could not check sign-in progress</strong><p>{progress.error.message}</p><button className="button subtle small" disabled={progress.isFetching} onClick={() => { void progress.refetch(); }}>Check progress</button></div>}{help}</>} />;
  return <section className={'connection-card ' + (connected ? 'is-connected' : '')}>
    <div className="connection-summary"><span className="connection-state-icon"><Icon name="shield" /></span><div><p className="caption">JIRA MX</p><h2>{connected ? 'Jira is ready' : 'Connect Jira'}</h2><p>{connected ? 'Your Samsung SSO session is active. You can open tickets, comments, and boards.' : 'Sign in once with your Samsung account to see your Jira work here.'}</p></div></div>
    <div className="connection-actions"><span className={'connection-pill ' + (connected ? 'online' : '')}>{connected ? 'Connected' : 'Not connected'}</span>{connected ? <a className="button subtle small" href="https://jira-mx.sec.samsung.net" target="_blank" rel="noreferrer">Open Jira MX ↗</a> : <button className="button primary" onClick={() => connect.mutate()}>{connect.isError ? 'Try again' : 'Connect Jira'}</button>}<button className="button subtle small" onClick={() => { void status.checkConnection(); }} disabled={status.isFetching}>{connected ? 'Refresh' : 'Check connection'}</button></div>
    {help}
    {connect.error && !connected && <p className="error">{connect.error.message}</p>}
    {progress.error && <p className="error">{progress.error.message}</p>}
    {progress.data?.phase === 'error' && !connected && <p className="error">{progress.data.message}</p>}
    {status.error && !waiting && !connected && <p className="error">{status.error.message}</p>}
  </section>;
}

export function IssueInsights({ issueKey }: { issueKey: string }) {
  const connection = useJiraStatus();
  const query = useQuery({ queryKey: ['insights', issueKey], queryFn: () => api<Insights>('/api/issues/' + issueKey + '/insights'), staleTime: 60_000, enabled: connection.connected });
  if (!connection.connected) return null;
  if (query.isLoading) return <section className="insights-card"><p className="loading">Loading Jira insights…</p></section>;
  if (query.error) return <section className="insights-card"><p className="error">{query.error.message}</p></section>;
  const data = query.data;
  return <section className="insights-card"><div className="section-title"><div className="section-heading"><span className="section-icon"><Icon name="calendar" /></span><div><p className="caption">ISSUE SIGNALS</p><h2>Timeline and team</h2><p>Key dates, watchers, work logged, and available workflow steps.</p></div></div><button className="button subtle small" onClick={() => query.refetch()}><Icon name="refresh" />Refresh</button></div><div className="insight-grid">
    <article><h3>Dates and workflow</h3><p>Due: {dateText(data?.dates?.duedate)}</p><p>Resolved: {dateText(data?.dates?.resolutiondate)}</p><ul>{(data?.dates?.status_changes ?? []).slice(-5).reverse().map((change, index) => <li key={index}>{change.from || 'Start'} → {change.to}<small>{dateText(change.at)}</small></li>)}</ul>{!data?.dates && <p className="hint">Timeline unavailable.</p>}</article>
    <article><h3>Watchers</h3><p>{data?.watchers?.count ?? 0} people watching</p><p className="hint">{data?.watchers?.watchers?.map(watcher => watcher.displayName).filter(Boolean).slice(0, 6).join(', ') || 'No names available.'}</p></article>
    <article><h3>Work logged</h3><ul>{(data?.worklog?.worklogs ?? []).slice(-5).reverse().map(entry => <li key={entry.id}>{entry.timeSpent} · {entry.author}</li>)}</ul>{!data?.worklog?.worklogs?.length && <p className="hint">No worklog entries.</p>}</article>
    <article><h3>Available next steps</h3><div className="chips">{(data?.transitions?.transitions ?? []).map(transition => <span key={transition.id}>{transition.name} → {transition.to}</span>)}</div>{!data?.transitions?.transitions?.length && <p className="hint">No transitions available.</p>}</article>
  </div></section>;
}

type Board = { id: number; name: string; type: string };
export function BoardsPanel() {
  const connection = useJiraStatus();
  const connected = connection.connected;
  const [project, setProject] = useState('');
  const [selected, setSelected] = useState<Board | null>(null);
  const [searchedProject, setSearchedProject] = useState<string | null>(null);
  const boards = useQuery({ queryKey: ['boards', searchedProject], queryFn: () => api<{ boards: Board[] }>('/api/boards' + (searchedProject ? '?project=' + encodeURIComponent(searchedProject) : '')), enabled: connected && searchedProject !== null });
  const sprints = useQuery({ queryKey: ['sprints', selected?.id], queryFn: () => api<{ sprints: { id: number; name: string; state: string }[] }>('/api/boards/' + selected!.id + '/sprints'), enabled: connected && Boolean(selected) });
  return <section className="boards-card"><div className="section-title"><div className="section-heading"><span className="section-icon"><Icon name="board" /></span><div><p className="caption">AGILE</p><h2>Find a board</h2><p>Browse boards and see active sprints.</p></div></div><div className="board-search"><input aria-label="Project key" value={project} onChange={event => setProject(event.target.value.toUpperCase())} placeholder="Project key (optional)" /><button className="button subtle" onClick={() => { if (searchedProject === project) void boards.refetch(); else setSearchedProject(project); }} disabled={!connected || boards.isFetching || !/^(|[A-Z][A-Z0-9_]{0,19})$/.test(project)}>{boards.isFetching ? 'Loading…' : 'Find boards'}</button></div></div>
    {!connected && <div className="empty-state"><strong>Connect Jira to browse boards</strong><p>Sign in above to search Jira MX boards.</p></div>}
    {boards.error && connected && <p className="error">{boards.error.message}</p>}
    {boards.data && connected && <div className="board-list">{boards.data.boards.map(board => <button key={board.id} className={'board-chip ' + (selected?.id === board.id ? 'active' : '')} onClick={() => setSelected(board)}><span className="section-icon"><Icon name="board" /></span><span className="board-chip-copy">{board.name}<small>{board.type}</small></span></button>)}</div>}
    {connected && boards.data?.boards.length === 0 && <div className="empty-state"><p>No boards match this project.</p></div>}
    {selected && connected && <div className="sprint-list"><h3>{selected.name} · active sprints</h3>{sprints.isLoading && <p className="loading">Loading sprints…</p>}{sprints.error && <p className="error">{sprints.error.message}</p>}{sprints.data?.sprints.length === 0 && <p className="hint">No active sprints.</p>}{sprints.data?.sprints.map(sprint => <span key={sprint.id}>{sprint.name}</span>)}</div>}
  </section>;
}
