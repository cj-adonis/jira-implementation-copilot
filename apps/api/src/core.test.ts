import { describe, expect, it } from 'vitest';
import { issueKeySchema } from '@jira-copilot/shared';
import { cleanupWiki, normalizeIssue } from './jira.js';
import { buildPrompt } from './analysis.js';

describe('ticket safeguards', () => {
  it('normalizes Jira keys and rejects malformed values', () => {
    expect(issueKeySchema.parse(' cbcc-1737 ')).toBe('CBCC-1737');
    expect(issueKeySchema.safeParse('not a key').success).toBe(false);
  });
  it('cleans wiki markup without losing source text', () => {
    expect(cleanupWiki('*Ship* [the change|https://example.test] {color:red}today{color}')).toBe('Ship the change today');
  });
  it('bounds normalized comments and builds an untrusted-data prompt', () => {
    const issue = normalizeIssue({ key:'CBCC-1737', fields:{ summary:'Improve sign-in', comment:{ comments:Array.from({ length:12 }, (_, i) => ({ body:`comment ${i}` })) } } });
    expect(issue.comments).toHaveLength(10);
    expect(buildPrompt(issue)).toContain('untrusted reference material');
  });
});
