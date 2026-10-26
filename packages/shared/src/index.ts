import { z } from 'zod';

export const jiraStatusSchema = z.object({
  browser: z.object({ running: z.boolean(), headless: z.boolean().nullable() }).optional(),
  sites: z.array(z.object({ service: z.string(), site: z.string(), logged_in: z.boolean(), site_open: z.boolean().optional(), hint: z.string().optional() }))
});
export type JiraStatus = z.infer<typeof jiraStatusSchema>;
export type ConnectionProgress = {
  phase: 'idle' | 'checking' | 'automatic' | 'browser' | 'connected' | 'error';
  message: string;
  startedAt: number | null;
};
export const isConnecting = (progress?: ConnectionProgress) => Boolean(progress && ['checking', 'automatic', 'browser'].includes(progress.phase));
export const isJiraConnected = (status?: JiraStatus, site = 'mx') => Boolean(status?.sites.some(entry => entry.service === 'jira' && entry.site === site && entry.logged_in));

export const issueKeySchema = z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,19}-\d+$/i, 'Enter a Jira issue key such as CBCC-1737').transform((value) => value.toUpperCase());
export const personSchema = z.object({ displayName: z.string().nullable(), accountId: z.string().nullable() });
export const taskFieldsSchema = z.object({
  dueDate: z.string().nullable().default(null), statusCategory: z.string().nullable().default(null),
  updated: z.string().nullable().default(null), blocked: z.boolean().default(false), blockedReasons: z.array(z.string()).default([])
});
export const ticketSchema = taskFieldsSchema.extend({
  key: z.string(), summary: z.string(), status: z.string().nullable(), assignee: z.string().nullable(), priority: z.string().nullable().default(null)
});
export type Ticket = z.infer<typeof ticketSchema>;
export const issueSchema = taskFieldsSchema.extend({
  key: z.string(), browseUrl: z.string().nullable(), summary: z.string(), description: z.string().nullable(), issueType: z.string().nullable(),
  status: z.string().nullable(), priority: z.string().nullable(), components: z.array(z.string()), labels: z.array(z.string()),
  reporter: personSchema.nullable(), assignee: personSchema.nullable(), created: z.string().nullable(), updated: z.string().nullable(),
  comments: z.array(z.object({ author: z.string().nullable(), body: z.string(), created: z.string().nullable() })),
  attachments: z.array(z.object({ filename: z.string(), mimeType: z.string().nullable() })),
  linkedIssues: z.array(z.object({ key: z.string(), summary: z.string().nullable(), relationship: z.string().nullable() }))
});
export type Issue = z.infer<typeof issueSchema>;

export const transitionIdSchema = z.string().regex(/^\d{1,20}$/);
export const transitionsSchema = z.object({ transitions: z.array(z.object({
  id: transitionIdSchema, name: z.string().min(1), to: z.string().nullable()
})) });
export type IssueTransition = z.infer<typeof transitionsSchema>['transitions'][number];
export const statusUpdateSchema = z.object({ key: issueKeySchema, transitionId: transitionIdSchema });
export const batchStatusUpdateSchema = z.object({
  updates: z.array(statusUpdateSchema).min(1).max(50)
    .refine(items => new Set(items.map(item => item.key)).size === items.length, 'Select each issue only once.')
});
export type StatusUpdate = z.infer<typeof statusUpdateSchema>;
export type StatusUpdateResult = { key: string; outcome: 'updated' | 'failed' | 'unknown' | 'skipped'; message: string };
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Choose a valid calendar date.');
export const quickActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('comment'), body: z.string().trim().min(1).max(16000), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('priority'), priorityId: transitionIdSchema, confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('dueDate'), dueDate: calendarDate.nullable(), confirmed: z.literal(true) }).strict()
]);
export type QuickAction = z.infer<typeof quickActionSchema>;
export type QuickActionResult = { outcome: 'updated' | 'failed' | 'unknown'; message: string };
export type EditOptions = { priorities: { id: string; name: string }[]; dueDateEditable: boolean; priority: string | null; dueDate: string | null };
