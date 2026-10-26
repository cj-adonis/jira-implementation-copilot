import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { quickActionSchema, type EditOptions, type QuickAction, type QuickActionResult } from '@jira-copilot/shared';
import { api } from './ui';
import { refreshJiraData, statusKey, useJiraStatus } from './connection';
import { Icon } from './Icon';

type Target = { key: string; summary: string; priority?: string | null; dueDate?: string | null };
export function QuickActionsButton({ target }: { target: Target }) {
  const [open, setOpen] = useState(false);
  const { connected } = useJiraStatus();
  return <><button className="button subtle small" disabled={!connected} aria-label={'Quick actions for ' + target.key} onClick={() => setOpen(true)}><Icon name="bolt" />Quick actions</button>{open && <QuickActions target={target} onClose={() => setOpen(false)} />}</>;
}

function QuickActions({ target, onClose }: { target: Target; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), submitting = useRef(false);
  const client = useQueryClient();
  const { connected } = useJiraStatus();
  const [action, setAction] = useState<QuickAction['action']>('comment');
  const [body, setBody] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [dueDate, setDueDate] = useState(target.dueDate ?? '');
  const [dateTouched, setDateTouched] = useState(false);
  const [review, setReview] = useState(false), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QuickActionResult | null>(null);
  const options = useQuery({ queryKey: ['edit-options', target.key], queryFn: () => api<EditOptions>('/api/issues/' + target.key + '/edit-options'), enabled: connected && action !== 'comment' && !result, staleTime: 0 });
  useEffect(() => { if (options.data && !dateTouched) setDueDate(options.data.dueDate ?? ''); }, [options.data, dateTouched]);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  const payload = action === 'comment' ? { action, body, confirmed: true } : action === 'priority' ? { action, priorityId, confirmed: true } : { action, dueDate: dueDate || null, confirmed: true };
  const parsed = quickActionSchema.safeParse(payload);
  const priority = options.data?.priorities.find(item => item.id === priorityId);
  const valid = connected && parsed.success && (action === 'comment' || (options.isSuccess && !options.isFetching && (action === 'priority' ? Boolean(priority && priority.name !== options.data.priority) : options.data.dueDateEditable && (dueDate || null) !== options.data.dueDate)));
  const save = async () => {
    if (submitting.current || !valid || !parsed.success) return;
    submitting.current = true; setBusy(true);
    try {
      setResult(await api<QuickActionResult>('/api/issues/' + target.key + '/quick-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data) }));
    } catch (error) {
      setResult({ outcome: 'unknown', message: (error instanceof Error ? error.message : 'The request failed.') + ' Check the issue in Jira before submitting this change again.' });
    } finally {
      void refreshJiraData(client); void client.invalidateQueries({ queryKey: statusKey }); setBusy(false); submitting.current = false;
    }
  };
  return <dialog ref={dialog} className="status-dialog quick-action-dialog" aria-labelledby="quick-action-title" onCancel={event => { event.stopPropagation(); event.preventDefault(); if (!submitting.current) onClose(); }}>
    <div className="panel-heading"><div><p className="eyebrow">JIRA MX · {target.key}</p><h2 id="quick-action-title">Quick actions</h2><p className="muted">{target.summary}</p></div><button className="button subtle small" disabled={busy} onClick={onClose}>Close</button></div>
    {result ? <div aria-live="polite"><p className={'status-result ' + result.outcome}>{result.message}</p><button className="button primary" onClick={onClose}>Done</button></div> : <>
      {review ? <div className="quick-review"><p>Apply this change to <strong>{target.key}</strong> in <strong>Jira MX</strong>?</p>{action === 'comment' ? <><strong>Add comment</strong><p className="comment-body">{body.trim()}</p></> : action === 'priority' ? <p>Priority: {options.data?.priority ?? 'None'} → <strong>{priority?.name}</strong></p> : <p>Due date: {options.data?.dueDate ?? 'Not set'} → <strong>{dueDate || 'Clear due date'}</strong></p>}</div> : <div className="quick-action-fields">
        <label>Action<select aria-label="Quick action" value={action} onChange={event => { setAction(event.target.value as QuickAction['action']); setReview(false); }}><option value="comment">Add comment</option><option value="priority">Change priority</option><option value="dueDate">Change due date</option></select></label>
        {action === 'comment' && <label>Comment<textarea aria-label="Comment" rows={6} maxLength={16000} value={body} onChange={event => setBody(event.target.value)} placeholder="Share progress, ask a question, or explain a blocker…" /><span className="field-note">This comment will be visible to people who can access the Jira issue.</span></label>}
        {action !== 'comment' && options.isFetching && <p className="loading" role="status">Loading editable fields…</p>}
        {action !== 'comment' && options.error && <div className="inline-error" role="alert"><p>{options.error.message}</p><button className="button subtle small" onClick={() => options.refetch()}>Try again</button></div>}
        {action === 'priority' && options.data && <label>Priority<select aria-label="New priority" value={priorityId} disabled={options.isFetching} onChange={event => setPriorityId(event.target.value)}><option value="">Choose a priority</option>{options.data.priorities.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{!options.data.priorities.length && <span className="field-note">Priority is not editable for this issue. Open it in Jira.</span>}</label>}
        {action === 'dueDate' && options.data && <label>Due date<input aria-label="New due date" type="date" value={dueDate} disabled={!options.data.dueDateEditable || options.isFetching} onChange={event => { setDateTouched(true); setDueDate(event.target.value); }} />{options.data.dueDateEditable ? <span className="field-note">Leave the date empty to clear it.</span> : <span className="field-note">Due date is not editable for this issue. Open it in Jira.</span>}</label>}
      </div>}
      <div className="status-actions">{review ? <><button className="button subtle" disabled={busy} onClick={() => setReview(false)}>Back</button><button className="button primary" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : 'Confirm change'}</button></> : <button className="button primary" disabled={!valid} onClick={() => setReview(true)}>Review change</button>}</div>
      {busy && <p role="status">Saving your change…</p>}
    </>}
  </dialog>;
}
