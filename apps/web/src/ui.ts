export type { Ticket } from '@jira-copilot/shared';
export type View = 'work' | 'boards' | 'issue';
export type Workspace = { selected: string; view: View; preview?: boolean };
export const workspaceKey = 'jira-copilot-workspace-v2';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(path, init); }
  catch { throw new ApiError(0, 'Cannot reach the local server. Check that the app is running, then try again.'); }
  let data: any;
  try { data = await response.json(); }
  catch { throw new ApiError(response.ok ? 502 : response.status, 'The local server returned an unreadable response. Check that the app is running, then try again.'); }
  if (!response.ok) throw new ApiError(response.status, typeof data?.error === 'string' ? data.error : 'Request failed. Try again.');
  return data as T;
}

export function readLocal<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; }
  catch { return fallback; }
}

export function dateText(value: string | null | undefined) {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
