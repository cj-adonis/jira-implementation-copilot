import Fastify from 'fastify'; import { z } from 'zod'; import { batchStatusUpdateSchema, transitionIdSchema, issueKeySchema } from '@jira-copilot/shared'; import { config } from './config.js'; import { AppError, JiraClient } from './jira.js';
export function createApp(jira = new JiraClient()) {
const app = Fastify({ logger: false });
app.setErrorHandler((error, _request, reply) => { const isValidationError = error instanceof Error && error.name === 'ZodError'; const status = error instanceof AppError ? error.statusCode : isValidationError || (error instanceof Error && 'statusCode' in error && error.statusCode === 400) ? 400 : 500; reply.status(status).send({ error: error instanceof AppError ? error.message : status === 400 ? 'Invalid settings or Jira issue key.' : 'Unexpected local server error.' }); });
app.get('/api/health', async () => ({ app: 'jira-mx-workspace', jira: true, jiraSite: config.jiraSite, desktopInstance: process.env.JIRA_DESKTOP_INSTANCE }));
app.get('/api/jira/status', async request => {
  const { fresh } = z.object({ fresh: z.enum(['true', 'false']).optional() }).parse(request.query);
  return jira.status(fresh === 'true');
});
app.get('/api/jira/connection-progress', async () => jira.connectionProgress());
app.post('/api/jira/login', async (_request, reply) => {
  // Progress survives HTTP disconnects and page reloads while SSO finishes.
  void jira.login().catch(() => { /* The failure is available through connection-progress. */ });
  return reply.code(202).send(jira.connectionProgress());
});
const filterText = z.string().regex(/^[A-Za-z0-9 ._-]{1,80}$/).optional(); const assignedQuerySchema = z.object({ status: filterText, project: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,19}$/).optional(), priority: filterText, label: filterText, updatedDays: z.coerce.number().int().min(1).max(365).optional() });
app.get('/api/issues/assigned', async (request) => { const query = assignedQuerySchema.parse(request.query); return { issues: await jira.getAssignedIssues(query) }; });
const activityQuery = z.object({ keys: z.string().max(300) }); app.get('/api/issues/comment-activity', async (request) => { const { keys } = activityQuery.parse(request.query); const parsed = keys.split(',').filter(Boolean).slice(0, 8).map(key => issueKeySchema.parse(key)); return { items: await jira.commentActivity(parsed) }; });
app.get('/api/issues/:issueKey/transitions', async request => jira.transitions(issueKeySchema.parse((request.params as any).issueKey)));
app.get('/api/issues/:issueKey/edit-options', async request => jira.editOptions(issueKeySchema.parse((request.params as any).issueKey)));
app.post('/api/issues/:issueKey/quick-action', async request => jira.quickAction(issueKeySchema.parse((request.params as any).issueKey), request.body as any));
app.post('/api/issues/status', async request => {
  const { updates } = batchStatusUpdateSchema.parse(request.body);
  return jira.updateStatuses(updates);
});
app.post('/api/issues/:issueKey/status', async request => {
  const key = issueKeySchema.parse((request.params as any).issueKey);
  const { transitionId } = z.object({ transitionId: transitionIdSchema }).parse(request.body);
  return jira.updateStatuses([{ key, transitionId }]);
});
app.get('/api/issues/:issueKey/insights', async (request) => jira.insights(issueKeySchema.parse((request.params as any).issueKey)));
app.get('/api/boards', async (request) => { const { project } = z.object({ project: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,19}$/).optional() }).parse(request.query); return jira.boards(project); });
app.get('/api/boards/:boardId/sprints', async (request) => { const id = z.coerce.number().int().positive().parse((request.params as any).boardId); return jira.sprints(id); });
app.get('/api/issues/:issueKey', async (request) => jira.getIssue(issueKeySchema.parse((request.params as any).issueKey)));
return app;
}
