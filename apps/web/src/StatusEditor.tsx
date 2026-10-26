import React, { useEffect, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { transitionsSchema, type IssueTransition, type StatusUpdateResult } from '@jira-copilot/shared';
import { api } from './ui';
import { refreshJiraData, statusKey, useJiraStatus } from './connection';

type Target = { key: string; status: string | null };
const label = (transition: IssueTransition) => transition.to && transition.to !== transition.name
  ? transition.to + ' (' + transition.name + ')' : transition.to ?? transition.name;

export function StatusEditor({ targets, onClose }: { targets: Target[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const client = useQueryClient();
  const { connected } = useJiraStatus();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<StatusUpdateResult[] | null>(null);
  const [error, setError] = useState('');
  const queries = useQueries({ queries: targets.map(target => ({
    queryKey: ['transitions', target.key],
    queryFn: async () => transitionsSchema.parse(await api('/api/issues/' + target.key + '/transitions')),
    enabled: connected && !busy && !results,
    staleTime: 0,
    retry: false
  })) });
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const transitions = queries.map(query => query.data?.transitions ?? []);
  const ready = connected && queries.every(query => query.isSuccess && !query.isFetching);
  const selected = targets.map((target, index) => transitions[index].find(item => item.id === choices[target.key]));
  const valid = ready && selected.every(Boolean);
  // A shared destination is safe only when it identifies one transition per issue.
  const common = [...new Set(transitions[0]?.map(item => item.to).filter((name): name is string => Boolean(name)) ?? [])]
    .filter(name => transitions.every(list => list.filter(item => item.to === name).length === 1));
  const save = async () => {
    if (submitting.current || !valid) return;
    submitting.current = true;
    setBusy(true); setError('');
    try {
      const updates = targets.map(target => ({ key: target.key, transitionId: choices[target.key] }));
      const single = updates.length === 1;
      const response = await api<{ results: StatusUpdateResult[] }>(single ? '/api/issues/' + updates[0].key + '/status' : '/api/issues/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(single ? { transitionId: updates[0].transitionId } : { updates })
      });
      setResults(response.results);
    } catch (failure) {
      setError((failure instanceof Error ? failure.message : 'The request failed.') + ' Some updates may have reached Jira. Close this editor and check current statuses before trying again.');
      // Do not offer a blind retry after a disconnected HTTP request.
      setResults([]);
    } finally {
      void refreshJiraData(client);
      void client.invalidateQueries({ queryKey: statusKey });
      setBusy(false); submitting.current = false;
    }
  };
  return <dialog ref={dialog} className="status-dialog" aria-labelledby="status-editor-title" onCancel={event => { event.preventDefault(); if (!submitting.current) onClose(); }}>
    <div className="panel-heading"><div><p className="eyebrow">JIRA MX</p><h2 id="status-editor-title">Update status</h2><p className="muted">{targets.length} issue{targets.length === 1 ? '' : 's'} selected</p></div>
      <button className="button subtle small" disabled={busy} onClick={onClose} aria-label="Close status editor">Close</button></div>
    {results ? <div aria-live="polite">
      <p>{results.filter(result => result.outcome === 'updated').length} of {targets.length} updated.</p>
      {results.map(result => <p className={'status-result ' + result.outcome} key={result.key}><strong>{result.key}: {result.outcome}</strong><span>{result.message}</span></p>)}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button className="button primary" onClick={onClose}>Done</button>
    </div> : <>
      {!connected && <p className="inline-error">Connect Jira before updating statuses.</p>}
      {review ? <><p>Apply these status changes in Jira MX?</p><ul className="status-review">{targets.map((target, index) => <li key={target.key}><strong>{target.key}</strong>: {target.status ?? 'No status'} &rarr; {selected[index] ? label(selected[index]!) : 'Choice no longer available'}</li>)}</ul></> : <>
        {targets.length > 1 && <label className="status-common">Set the same status for all
          <select value="" disabled={!ready || !common.length} onChange={event => setChoices(Object.fromEntries(targets.map((target, index) => [target.key, transitions[index].find(item => item.to === event.target.value)!.id])))}>
            <option value="">{common.length ? 'Choose a shared status' : 'Choose a transition for each issue below'}</option>{common.map(name => <option key={name}>{name}</option>)}
          </select></label>}
        <div className="status-choices">{targets.map((target, index) => <div className="status-choice" key={target.key}>
          <label htmlFor={'transition-' + target.key}><strong>{target.key}</strong><span>Current: {target.status ?? 'No status'}</span></label>
          <select id={'transition-' + target.key} value={choices[target.key] ?? ''} disabled={!connected || queries[index].isFetching || queries[index].isError || !transitions[index].length}
            onChange={event => setChoices(previous => ({ ...previous, [target.key]: event.target.value }))}>
            <option value="">{queries[index].isFetching ? 'Loading statuses...' : 'Choose a transition'}</option>
            {transitions[index].map(item => <option value={item.id} key={item.id}>{label(item)}</option>)}
          </select>
          {queries[index].isError && <p className="error" role="alert">{queries[index].error.message} <button className="button subtle small" onClick={() => queries[index].refetch()}>Try again</button></p>}
          {queries[index].isSuccess && !queries[index].isFetching && !transitions[index].length && <p className="muted">No transitions are available for this issue.</p>}
        </div>)}</div>
      </>}
      <p className="hint">Jira applies your workflow rules and permissions. If a transition requires extra fields, complete it in Jira.</p>
      <div className="status-actions">{review ? <><button className="button subtle" disabled={busy} onClick={() => setReview(false)}>Back</button><button className="button primary" disabled={!valid || busy} onClick={save}>{busy ? 'Updating...' : 'Confirm update'}</button></> : <button className="button primary" disabled={!valid} onClick={() => setReview(true)}>Review changes</button>}</div>
      {busy && <p role="status">Updating issues. Keep this editor open until results appear.</p>}
    </>}
  </dialog>;
}

export function IssueStatusButton({ issue }: { issue: Target }) {
  const [open, setOpen] = useState(false);
  const { connected } = useJiraStatus();
  return <><button className="button subtle small" disabled={!connected} onClick={() => setOpen(true)}>Update status</button>
    {open && <StatusEditor targets={[issue]} onClose={() => setOpen(false)} />}</>;
}
