import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { issueKeySchema, type Issue } from '@jira-copilot/shared';
import { JiraConnection, IssueInsights, BoardsPanel } from './JiraExtras';
import { IssueDetails } from './IssueView';
import { WorkView } from './WorkView';
import { IssueStatusButton } from './StatusEditor';
import { ThemeSelect } from './ThemeSelect';
import { IssuePreview } from './IssuePreview';
import { QuickActionsButton } from './QuickActions';
import { Icon } from './Icon';
import { PageHeader } from './PageHeader';
import { api, readLocal, workspaceKey, type View, type Workspace } from './ui';
import { createQueryClient, useJiraStatus } from './connection';
import './styles.css';
import './workspace.css';

const stored = readLocal<Partial<Workspace>>(workspaceKey, {});
const initialView: View = stored.view === 'boards' || (stored.view === 'issue' && stored.selected) ? stored.view : 'work';

function App() {
  const connection = useJiraStatus();
  const [selected, setSelected] = useState(stored.selected ?? '');
  const [view, setView] = useState<View>(initialView);
  const [preview, setPreview] = useState(Boolean(stored.preview && stored.selected && initialView === 'work'));
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState('');
  const issue = useQuery({
    queryKey: ['issue', selected],
    queryFn: () => api<Issue>('/api/issues/' + selected),
    enabled: connection.connected && Boolean(selected) && (view === 'issue' || preview)
  });

  useEffect(() => {
    try { localStorage.setItem(workspaceKey, JSON.stringify({ selected, view, preview })); } catch {}
  }, [selected, view, preview]);

  const select = (key: string) => {
    setSelected(key);
    setKeyInput('');
    setKeyError('');
    setPreview(true);
    setView('work');
  };
  const lookup = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = issueKeySchema.safeParse(keyInput);
    if (parsed.success) { setSelected(parsed.data); setPreview(false); setView('issue'); setKeyInput(''); setKeyError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else setKeyError('Use an issue key such as CBCC-1737.');
  };
  const nav: { id: Exclude<View, 'issue'>; label: string }[] = [
    { id: 'work', label: 'My issues' },
    { id: 'boards', label: 'Boards' }
  ];

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="topbar">
      <button className="brand" onClick={() => setView('work')} aria-label="Jira MX home"><span className="brand-mark">J</span><span><strong>Jira MX</strong><small>Workspace</small></span></button>
      <nav className="main-nav" aria-label="Main navigation">{nav.map(item => <button key={item.id} className={(view === 'issue' ? 'work' : view) === item.id ? 'active' : ''} aria-current={(view === 'issue' ? 'work' : view) === item.id ? 'page' : undefined} onClick={() => { setPreview(false); setView(item.id); }}><Icon name={item.id === 'work' ? 'work' : 'board'} />{item.label}</button>)}</nav>
      <form className="quick-lookup" onSubmit={lookup}><Icon name="search" /><label className="visually-hidden" htmlFor="quick-key">Open Jira issue by key</label><input id="quick-key" value={keyInput} aria-invalid={Boolean(keyError)} aria-describedby={keyError ? 'key-error' : undefined} onChange={event => { setKeyInput(event.target.value.toUpperCase()); setKeyError(''); }} placeholder="Issue key, e.g. CBCC-1737" /><button className="button primary" type="submit">Open</button></form>
      <ThemeSelect />
    </header>
    {keyError && <div id="key-error" className="top-error" role="alert">{keyError}</div>}
    <main id="main-content" className="content" tabIndex={-1}>
      <JiraConnection />
      <div hidden={view !== 'work' || connection.preparing}><PageHeader eyebrow="YOUR WORKSPACE" title="My issues" description="Plan your day, track deadlines, and open an issue beside your list." icon="work" /><div className={'work-layout' + (preview ? ' has-preview' : '')}><div className="work-list"><WorkView onSelect={select} /></div>{view === 'work' && preview && !connection.preparing && <IssuePreview issueKey={selected} issue={issue.data} loading={issue.isLoading} error={issue.error} onRetry={() => { void issue.refetch(); }} onClose={() => setPreview(false)} onExpand={() => { setPreview(false); setView('issue'); window.scrollTo({ top: 0 }); }} />}</div></div>
      {view === 'boards' && !connection.preparing && <><PageHeader eyebrow="TEAM WORK" title="Boards and sprints" description="Find a board and check its active sprints." icon="board" /><BoardsPanel /></>}
      {view === 'issue' && !connection.preparing && <><div className="issue-header"><button className="back-link" onClick={() => setView('work')}>← My issues</button><p className="eyebrow">{selected}</p><h1>{issue.data?.summary ?? selected}</h1><div className="issue-subtitle"><span className="status-tag">{issue.data?.status ?? (issue.error ? 'Unavailable' : 'Loading')}</span>{issue.data && <><IssueStatusButton key={issue.data.key} issue={issue.data} /><QuickActionsButton key={'quick-' + issue.data.key} target={issue.data} /></>}{issue.data?.browseUrl && <a href={issue.data.browseUrl} target="_blank" rel="noreferrer">Open in Jira ↗</a>}</div></div>
        {issue.isLoading && <div className="panel loading-panel">Loading issue details…</div>}
        {issue.error && <div className="inline-error"><strong>Could not open this issue</strong><p>{issue.error.message}</p><button className="button subtle small" onClick={() => issue.refetch()}>Try again</button></div>}
        {issue.data && <><IssueDetails issue={issue.data} /><IssueInsights issueKey={issue.data.key} /></>}
      </>}
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={createQueryClient()}><App /></QueryClientProvider></React.StrictMode>);
