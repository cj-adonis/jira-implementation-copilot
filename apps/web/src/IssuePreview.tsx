import React, { useEffect, useRef, useState } from 'react';
import type { Issue } from '@jira-copilot/shared';
import { IssueDetails } from './IssueView';
import { IssueStatusButton } from './StatusEditor';
import { QuickActionsButton } from './QuickActions';
import { TaskMeta } from './TaskMeta';

export function IssuePreview({ issueKey, issue, loading, error, onRetry, onClose, onExpand }: {
  issueKey: string; issue?: Issue; loading: boolean; error: Error | null; onRetry: () => void; onClose: () => void; onExpand: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 980px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    if (mobile) node?.showModal(); else node?.show();
    return () => { node?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [mobile]);
  useEffect(() => { if (dialog.current) dialog.current.scrollTop = 0; }, [issueKey]);
  return <dialog ref={dialog} className="issue-preview" aria-labelledby="preview-title" onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); onClose(); }} onKeyDown={event => { if (event.key === 'Escape' && (event.target as Element).closest('dialog') === event.currentTarget) { event.preventDefault(); onClose(); } }}>
    <div className="preview-toolbar"><strong>{issueKey}</strong><button className="button subtle small" onClick={onExpand}>Open full issue</button><button className="button subtle small" onClick={onClose}>Close preview</button></div>
    <div className="preview-content"><h2 id="preview-title">{issue?.summary ?? issueKey}</h2>
      {loading && <p className="loading" role="status">Loading issue details…</p>}
      {error && <div className="inline-error" role="alert"><p>{error.message}</p><button className="button subtle small" onClick={onRetry}>Try again</button></div>}
      {issue && <><div className="issue-subtitle"><span className="status-tag">{issue.status ?? 'No status'}</span><IssueStatusButton issue={issue} /><QuickActionsButton target={issue} /></div><div className="preview-meta"><TaskMeta task={issue} /></div><IssueDetails issue={issue} /></>}
    </div>
  </dialog>;
}
