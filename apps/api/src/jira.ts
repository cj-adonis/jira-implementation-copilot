import { issueKeySchema, issueSchema, type Issue } from '@jira-copilot/shared';
import { config } from './config.js';

export class AppError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
const text = (value: unknown): string | null => typeof value === 'string' ? value : value ? JSON.stringify(value) : null;
const person = (value: any) => value ? { displayName: value.displayName ?? value.name ?? null, accountId: value.accountId ?? null } : null;
export function cleanupWiki(value: string | null): string | null { return value?.replace(/\{code(?::[^}]*)?\}/gi, '```').replace(/\{noformat\}/gi, '```').replace(/\[([^\]|]+)\|[^\]]+\]/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\{[^}]+\}/g, '').trim() || null; }
export function normalizeIssue(raw: any): Issue {
  const f = raw.fields ?? {}; const links = f.issuelinks ?? [];
  return issueSchema.parse({ key: raw.key, browseUrl: config.jiraBaseUrl ? config.jiraBaseUrl + '/browse/' + raw.key : null, summary: f.summary ?? '', description: cleanupWiki(text(f.description)), issueType: f.issuetype?.name ?? null, status: f.status?.name ?? null, priority: f.priority?.name ?? null,
    components: (f.components ?? []).map((x: any) => x.name).filter(Boolean), labels: f.labels ?? [], reporter: person(f.reporter), assignee: person(f.assignee), created: f.created ?? null, updated: f.updated ?? null,
    comments: (f.comment?.comments ?? []).slice(-10).map((x: any) => ({ author: x.author?.displayName ?? null, body: cleanupWiki(text(x.body)) ?? '', created: x.created ?? null })),
    attachments: (f.attachment ?? []).map((x: any) => ({ filename: x.filename, mimeType: x.mimeType ?? null })),
    linkedIssues: links.map((x: any) => { const issue = x.outwardIssue ?? x.inwardIssue; return { key: issue?.key ?? 'unknown', summary: issue?.fields?.summary ?? null, relationship: x.type?.outward ?? x.type?.inward ?? null }; }).filter((x: any) => x.key !== 'unknown') });
}
export class JiraClient {
  async getIssue(input: string): Promise<Issue> {
    const key = issueKeySchema.parse(input); if (!config.jiraBaseUrl || !config.jiraPat) throw new AppError(503, 'Jira is not configured on the local server.');
    let response: Response; try { response = await fetch(`${config.jiraBaseUrl}/rest/api/2/issue/${encodeURIComponent(key)}?fields=summary,description,issuetype,status,priority,components,labels,reporter,assignee,created,updated,comment,attachment,issuelinks`, { headers: { Authorization: `Bearer ${config.jiraPat}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) }); } catch { throw new AppError(504, 'Jira did not respond in time.'); }
    if (!response.ok) { const messages: Record<number,string> = { 401: 'Jira authentication failed.', 403: 'You do not have permission to view this issue.', 404: 'Issue not found or unavailable.', 429: 'Jira rate limit reached. Try again shortly.' }; throw new AppError(response.status, messages[response.status] ?? 'Jira could not retrieve this issue.'); }
    return normalizeIssue(await response.json());
  }

  async getAssignedIssues(status?: string) {
    if (!config.jiraBaseUrl || !config.jiraPat) throw new AppError(503, 'Jira is not configured on the local server.');
    const jql = 'assignee = currentUser()' + (status ? ' AND status = ' + JSON.stringify(status) : '') + ' ORDER BY updated DESC';
    const params = new URLSearchParams({ jql, fields: 'summary,issuetype,status,priority,assignee,updated', maxResults: '50' });
    let response: Response; try { response = await fetch(`${config.jiraBaseUrl}/rest/api/2/search?${params}`, { headers: { Authorization: `Bearer ${config.jiraPat}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) }); } catch { throw new AppError(504, 'Jira did not respond in time.'); }
    if (!response.ok) { const messages: Record<number,string> = { 401: 'Jira authentication failed.', 403: 'You do not have permission to search assigned issues.', 429: 'Jira rate limit reached. Try again shortly.' }; throw new AppError(response.status, messages[response.status] ?? 'Jira could not retrieve assigned issues.'); }
    const data = await response.json(); return (data.issues ?? []).map((issue: any) => ({ key: issue.key, summary: issue.fields?.summary ?? '', issueType: issue.fields?.issuetype?.name ?? null, status: issue.fields?.status?.name ?? null, priority: issue.fields?.priority?.name ?? null, updated: issue.fields?.updated ?? null }));
  }
}
