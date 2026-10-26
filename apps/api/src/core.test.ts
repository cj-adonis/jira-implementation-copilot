import { describe, expect, it } from 'vitest';
import { issueKeySchema } from '@jira-copilot/shared';
import { cleanupWiki, normalizeIssue } from './jira.js';
import { config } from './config.js';

describe('ticket safeguards', () => {
  it('always uses managing-jira MX', () => {
    expect(config.jiraSite).toBe('mx');
  });
  it('normalizes Jira keys and rejects malformed values', () => {
    expect(issueKeySchema.parse(' cbcc-1737 ')).toBe('CBCC-1737');
    expect(issueKeySchema.safeParse('not a key').success).toBe(false);
  });
  it('cleans wiki markup without losing source text', () => {
    expect(cleanupWiki('*Ship* [the change|https://example.test] {color:red}today{color}')).toBe('Ship the change today');
  });
  it('preserves every comment in a long thread', () => {
    const issue = normalizeIssue({ key:'CBCC-1737', fields:{ summary:'Improve sign-in', comment:{ comments:Array.from({ length:12 }, (_, i) => ({ body:`comment ${i}` })) } } });
    expect(issue.comments).toHaveLength(12);
    expect(issue.comments[0].body).toBe('comment 0');
    expect(issue.comments[11].body).toBe('comment 11');
  });
  it('normalizes managing-jira CLI issue output and preserves recent comments', () => {
    const issue = normalizeIssue({
      key: 'CBCC-1737', summary: 'Review login', status: 'In Progress', assignee: 'Jane',
      priority: { name: 'High' }, comments: [
        { id: '1', author: 'Alex', body: '*Please review*', created: '2026-10-22T10:00:00+0800' }
      ],
      issuelinks: [{ outwardIssue: { key: 'CBCC-1738', fields: { summary: 'Follow-up' } }, type: { outward: 'blocks' } }]
    }, 'https://jira.sec.samsung.net');
    expect(issue.status).toBe('In Progress');
    expect(issue.assignee?.displayName).toBe('Jane');
    expect(issue.comments[0].body).toBe('Please review');
    expect(issue.linkedIssues[0].key).toBe('CBCC-1738');
    expect(issue.browseUrl).toBe('https://jira.sec.samsung.net/browse/CBCC-1737');
  });
});
