import { z } from 'zod';

export const issueKeySchema = z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,19}-\d+$/i, 'Enter a Jira issue key such as CBCC-1737').transform((value) => value.toUpperCase());
export const personSchema = z.object({ displayName: z.string().nullable(), accountId: z.string().nullable() });
export const issueSchema = z.object({
  key: z.string(), browseUrl: z.string().nullable(), summary: z.string(), description: z.string().nullable(), issueType: z.string().nullable(),
  status: z.string().nullable(), priority: z.string().nullable(), components: z.array(z.string()), labels: z.array(z.string()),
  reporter: personSchema.nullable(), assignee: personSchema.nullable(), created: z.string().nullable(), updated: z.string().nullable(),
  comments: z.array(z.object({ author: z.string().nullable(), body: z.string(), created: z.string().nullable() })),
  attachments: z.array(z.object({ filename: z.string(), mimeType: z.string().nullable() })),
  linkedIssues: z.array(z.object({ key: z.string(), summary: z.string().nullable(), relationship: z.string().nullable() }))
});
export const analysisSchema = z.object({
  briefing: z.object({
    goal: z.string(), background: z.array(z.string()), scope: z.array(z.string()), requirements: z.array(z.string()),
    exclusions: z.array(z.string()), openQuestions: z.array(z.string()), acceptanceCriteria: z.array(z.string())
  }),
  plan: z.object({
    implementationSteps: z.array(z.string()), likelyCodeAreas: z.array(z.string()), suggestedTests: z.array(z.string()),
    dependencies: z.array(z.string()), assumptions: z.array(z.string()), risks: z.array(z.string())
  })
});
export type Issue = z.infer<typeof issueSchema>;
export type Analysis = z.infer<typeof analysisSchema>;
