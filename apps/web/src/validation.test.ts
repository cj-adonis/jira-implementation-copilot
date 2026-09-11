import { describe, expect, it } from 'vitest';
import { issueKeySchema } from '@jira-copilot/shared';

describe('issue-key form validation', () => {
  it('accepts standard Jira keys and canonicalizes their case', () => {
    expect(issueKeySchema.parse('cbcc-1737')).toBe('CBCC-1737');
  });
  it('blocks invalid keys before a request is made', () => {
    expect(issueKeySchema.safeParse('CBCC 1737').success).toBe(false);
  });
});
