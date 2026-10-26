import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type ConnectionProgress } from '@jira-copilot/shared';
import { api, ApiError } from './ui';
import { createQueryClient, refreshJiraData, statusKey, progressKey } from './connection';
import { JiraConnection } from './JiraExtras';

const status = (logged_in: boolean) => ({ sites: [{ service: 'jira', site: 'mx', logged_in }] });
afterEach(() => vi.unstubAllGlobals());
describe('API failure messages', () => {
  it('handles a stopped API server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api('/api/jira/status')).rejects.toMatchObject({ status: 0, message: expect.stringContaining('local server') });
  });
  it.each([200, 502, 504])('handles non-JSON proxy responses with HTTP %i', async code => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Error</html>', { status: code })));
    await expect(api('/api/jira/status')).rejects.toMatchObject({ status: code === 200 ? 502 : code, message: expect.stringContaining('unreadable response') });
  });
  it('preserves API error status and message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Reconnect Jira' }, { status: 401 })));
    await expect(api('/api/issues/assigned')).rejects.toMatchObject({ status: 401, message: 'Reconnect Jira' });
  });
});
describe('connection cache recovery', () => {
  it('marks every Jira view stale after connecting, including previously failed views', async () => {
    const client = createQueryClient();
    for (const key of ['assigned', 'issue', 'insights', 'boards', 'sprints', 'comment-activity', 'transitions', 'unrelated']) client.setQueryData([key], {});
    await refreshJiraData(client);
    for (const key of ['assigned', 'issue', 'insights', 'boards', 'sprints', 'comment-activity', 'transitions']) expect(client.getQueryState([key])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['unrelated'])?.isInvalidated).toBe(false);
    client.clear();
  });
  it('clears stale connected state on session expiry and does not retry the request', async () => {
    const client = createQueryClient();
    client.setQueryData(statusKey, status(true));
    const queryFn = vi.fn().mockRejectedValue(new ApiError(401, 'Expired'));
    await expect(client.fetchQuery({ queryKey: ['issue', 'ABC-1'], queryFn })).rejects.toThrow('Expired');
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(statusKey)).toEqual(status(false));
    client.clear();
  });
  it('keeps the valid connection when one project denies access', async () => {
    const client = createQueryClient();
    client.setQueryData(statusKey, status(true));
    await expect(client.fetchQuery({ queryKey: ['issue', 'ABC-1'], queryFn: () => Promise.reject(new ApiError(403, 'Denied')) })).rejects.toThrow('Denied');
    expect(client.getQueryData(statusKey)).toEqual(status(true));
    client.clear();
  });
});
describe('connection card rendering', () => {
  function render(phase: ConnectionProgress['phase'], loggedIn = false, message = '') {
    const client = createQueryClient();
    client.setQueryData(progressKey, { phase, message, startedAt: phase === 'idle' ? null : Date.now() });
    client.setQueryData(statusKey, status(loggedIn));
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><JiraConnection /></QueryClientProvider>);
    client.clear();
    return html;
  }
  it('offers Connect when the managed browser is closed', () => {
    expect(render('idle')).toContain('Connect Jira');
    expect(render('idle')).toContain('Not connected');
  });
  it('shows an existing signed-in session', () => {
    expect(render('idle', true)).toContain('Jira is ready');
  });
  it.each(['checking', 'automatic', 'browser'] as const)('restores an ongoing %s attempt after navigation/reload', phase => {
    const html = render(phase, true, 'Current SSO step');
    expect(html).toContain('Connecting');
    expect(html).toContain('Current SSO step');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-current="step"');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('<h2>Jira is ready</h2>');
  });
  it('shows background login failure after the POST has completed', () => {
    expect(render('error', false, 'VPN unavailable')).toContain('VPN unavailable');
    expect(render('error', false, 'VPN unavailable')).not.toContain('role="progressbar"');
  });
});
