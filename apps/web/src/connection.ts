import { QueryCache, QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { isJiraConnected, isConnecting, jiraStatusSchema, type ConnectionProgress, type JiraStatus } from '@jira-copilot/shared';
import { api, ApiError } from './ui';

export { isJiraConnected, isConnecting };
export const statusKey = ['jira-status', 'mx'] as const;
export const progressKey = ['jira-connection-progress'] as const;
const dataKeys = new Set(['assigned', 'issue', 'insights', 'boards', 'sprints', 'comment-activity', 'transitions', 'edit-options']);

export function refreshJiraData(client: QueryClient) {
  return client.invalidateQueries({ predicate: query => dataKeys.has(String(query.queryKey[0])) });
}
export function createQueryClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (!(error instanceof ApiError) || error.status !== 401 || !dataKeys.has(String(query.queryKey[0]))) return;
        client.setQueryData<JiraStatus>(statusKey, old => ({ ...old, sites: (old?.sites ?? [{ service: 'jira', site: 'mx', logged_in: false }]).map(entry => entry.service === 'jira' && entry.site === 'mx' ? { ...entry, logged_in: false } : entry) }));
        void client.invalidateQueries({ queryKey: statusKey });
      }
    })
  });
  return client;
}
export function useJiraProgress() {
  return useQuery({
    queryKey: progressKey,
    queryFn: () => api<ConnectionProgress>('/api/jira/connection-progress'),
    staleTime: 1_000,
    refetchInterval: query => isConnecting(query.state.data) ? 1_500 : 10_000,
    retry: false
  });
}
async function fetchJiraStatus(fresh = false): Promise<JiraStatus> {
  const parsed = jiraStatusSchema.safeParse(await api<unknown>('/api/jira/status' + (fresh ? '?fresh=true' : '')));
  if (!parsed.success || !parsed.data.sites.some(entry => entry.service === 'jira' && entry.site === 'mx')) throw new ApiError(502, 'The server returned an invalid Jira MX session status.');
  return parsed.data;
}
export function useJiraStatus() {
  const client = useQueryClient();
  const progress = useJiraProgress();
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => fetchJiraStatus(),
    staleTime: 15_000,
    enabled: progress.isSuccess && !isConnecting(progress.data),
    refetchInterval: 30_000,
    retry: false
  });
  const checkConnection = () => client.fetchQuery({ queryKey: statusKey, queryFn: () => fetchJiraStatus(true), staleTime: 0 }).catch(() => undefined);
  const preparing = isConnecting(progress.data) || (!status.isError && !progress.isError && progress.data?.phase !== 'error' && (progress.isPending || status.isPending));
  return { ...status, checkConnection, preparing, connected: !status.isError && !progress.isError && !isConnecting(progress.data) && isJiraConnected(status.data) };
}
