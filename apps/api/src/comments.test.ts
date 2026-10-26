import { describe, expect, it, vi } from 'vitest';
import { AppError, JiraClient, normalizeIssue, type JiraRunner } from './jira.js';

const connected = { sites: [{ service: 'jira', site: 'mx', logged_in: true }] };
describe('complete comment conversations', () => {
  it('preserves long threads from the CLI without trimming comment bodies', async () => {
    const comments = Array.from({ length: 26 }, (_, i) => ({ author: 'Alex', created: `2020-01-${String(i + 1).padStart(2, '0')}T12:00:00Z`, body: `Comment ${i}: ` + 'full text '.repeat(50) }));
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(connected).mockResolvedValueOnce({ comments });
    const [activity] = await new JiraClient(run).commentActivity(['TEST-1']);
    expect(activity.comments).toHaveLength(26);
    expect(activity.comments[0].body).toBe(comments[0].body.trim());
    expect(activity.latest?.body).toBe(comments[25].body.trim());
    expect(activity.count).toBe(26);
  });
  it('chooses the newest dated comment even when Jira returns an unordered thread', async () => {
    const comments = [
      { author: 'Alex', created: '2020-02-01T12:00:00Z', body: 'Newest' },
      { author: 'Jane', created: '2020-01-01T12:00:00Z', body: 'Older' },
      { author: null, created: null, body: 'Undated' }
    ];
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(connected).mockResolvedValueOnce({ fields: { comment: { comments } } });
    const [activity] = await new JiraClient(run).commentActivity(['TEST-1']);
    expect(activity.latest?.body).toBe('Newest');
    expect(activity.comments).toHaveLength(3);
    expect(activity.comments[2].created).toBeNull();
  });
  it('keeps accessible threads when one issue is forbidden', async () => {
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(connected)
      .mockRejectedValueOnce(new AppError(403, 'No access'))
      .mockResolvedValueOnce(connected)
      .mockResolvedValueOnce({ comments: [{ body: 'Visible' }] });
    const result = await new JiraClient(run).commentActivity(['TEST-1', 'TEST-2']);
    expect(result[0]).toMatchObject({ key: 'TEST-1', comments: [], error: 'No access' });
    expect(result[1].comments[0].body).toBe('Visible');
  });
  it('preserves an empty thread', () => {
    expect(normalizeIssue({ key: 'TEST-1', comments: [] }).comments).toEqual([]);
  });
});

describe('complete assigned issue list', () => {
  it('loads later Jira pages instead of silently stopping at 50 issues', async () => {
    const issues = Array.from({ length: 53 }, (_, i) => ({ key: `TEST-${i + 1}`, summary: `Issue ${i + 1}` }));
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(connected)
      .mockResolvedValueOnce({ total: 53, issues: issues.slice(0, 50) })
      .mockResolvedValueOnce({ total: 53, issues: issues.slice(50) });
    const result = await new JiraClient(run).getAssignedIssues();
    expect(result).toHaveLength(53);
    expect(result[52].key).toBe('TEST-53');
    expect(run.mock.calls[1][0].slice(-2)).toEqual(['--startAt', '0']);
    expect(run.mock.calls[2][0].slice(-2)).toEqual(['--startAt', '50']);
  });
  it('continues when the Jira server uses a smaller page size', async () => {
    const run = vi.fn<JiraRunner>().mockResolvedValueOnce(connected)
      .mockResolvedValueOnce({ total: 3, issues: [{ key: 'TEST-1' }, { key: 'TEST-2' }] })
      .mockResolvedValueOnce({ total: 3, issues: [{ key: 'TEST-3' }] });
    expect(await new JiraClient(run).getAssignedIssues()).toHaveLength(3);
    expect(run.mock.calls[2][0].slice(-2)).toEqual(['--startAt', '2']);
  });
});
