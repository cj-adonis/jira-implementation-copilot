import React, { useEffect, useState } from 'react';
import type { Issue } from '@jira-copilot/shared';
import { markCommentsSeen } from './JiraExtras';
import { dateText } from './ui';

export function IssueDetails({ issue }: { issue: Issue }) {
  const [search, setSearch] = useState('');
  const [order, setOrder] = useState('newest');
  const timestamp = (value: string | null) => Date.parse(value ?? '') || 0;
  const latest = issue.comments.reduce<Issue['comments'][number] | undefined>((last, comment) => !last || timestamp(comment.created) >= timestamp(last.created) ? comment : last, undefined);
  const comments = issue.comments.filter(comment => `${comment.author ?? ''} ${comment.body}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => (timestamp(b.created) - timestamp(a.created)) * (order === 'oldest' ? -1 : 1));
  useEffect(() => { setSearch(''); setOrder('newest'); }, [issue.key]);
  useEffect(() => { markCommentsSeen(issue.key, latest?.created); }, [issue.key, latest?.created]);
  return <div className="issue-grid">
    <div className="issue-primary">
      <section className="panel detail-card"><p className="eyebrow">TICKET OVERVIEW</p><h2>Description</h2><p className="description-text">{issue.description ?? 'No description was provided for this ticket.'}</p></section>
      <section className="panel detail-card"><div className="panel-heading"><div><p className="eyebrow">CONVERSATION</p><h2>All comments</h2></div><span className="count-badge">{issue.comments.length}</span></div>
        {issue.comments.length > 0 && <div className="filter-bar"><label className="search-field"><span className="visually-hidden">Search this conversation</span><input type="search" placeholder="Search this conversation" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Conversation order" value={order} onChange={event => setOrder(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></div>}
        {comments.length ? <div className="comment-list">{comments.map((comment, index) =>
          <article className="comment" key={index}><div className="comment-avatar">{(comment.author ?? '?').slice(0, 1).toUpperCase()}</div><div><div className="comment-meta"><strong>{comment.author ?? 'Unknown author'}</strong><time>{dateText(comment.created)}</time></div><p>{comment.body || 'No text'}</p></div></article>
        )}</div> : <p className="muted">{search ? 'No comments match your search.' : 'No comments on this issue.'}</p>}
      </section>
    </div>
    <aside className="issue-secondary">
      <section className="panel detail-card"><p className="eyebrow">DETAILS</p><h2>At a glance</h2><dl className="detail-list"><div><dt>Status</dt><dd>{issue.status ?? 'Not set'}</dd></div><div><dt>Priority</dt><dd>{issue.priority ?? 'Not set'}</dd></div><div><dt>Type</dt><dd>{issue.issueType ?? 'Not set'}</dd></div><div><dt>Assignee</dt><dd>{issue.assignee?.displayName ?? 'Unassigned'}</dd></div><div><dt>Reporter</dt><dd>{issue.reporter?.displayName ?? 'Unknown'}</dd></div><div><dt>Updated</dt><dd>{dateText(issue.updated)}</dd></div></dl></section>
      <section className="panel detail-card"><p className="eyebrow">RELATED</p><h2>Linked issues</h2>{issue.linkedIssues.length ? issue.linkedIssues.map(link => <div className="related-row" key={link.key}><b>{link.key}</b><span>{link.relationship ?? 'Related'} · {link.summary ?? ''}</span></div>) : <p className="muted">No linked issues.</p>}</section>
      <section className="panel detail-card"><p className="eyebrow">FILES</p><h2>Attachments</h2>{issue.attachments.length ? issue.attachments.map((attachment, index) => <p className="attachment-row" key={index}>{attachment.filename}</p>) : <p className="muted">No attachments.</p>}</section>
    </aside>
  </div>;
}
