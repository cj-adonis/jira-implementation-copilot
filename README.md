# Jira Implementation Copilot

A local, read-only Jira ticket briefing and implementation-planning app. It never creates, edits, comments on, transitions, or deletes Jira issues.

## Quick start

Prerequisites: Node.js 20+, npm, a Jira Personal Access Token, and one AI provider (signed-in Gemini CLI, Codex CLI, Claude CLI, or OpenAI/Gemini API key).

1. Clone the repository.
2. Run npm install.
3. Run npm run dev.
4. Open the Vite URL printed in the terminal.
5. Click Configure and enter your own Jira base URL and PAT.

Each developer uses their own credentials. The .env file is ignored by Git.

## Jira setup and required permissions

This app uses Jira Server/Data Center Bearer PAT authentication.

JIRA_BASE_URL=https://jira.your-company.example
JIRA_PAT=your-personal-access-token

The Jira PAT owner needs Browse Projects access for each relevant project, applicable issue-security access, and permission to view comments if comments are included as AI context. No Jira write permissions are required.

## Read-only Jira REST APIs used

- GET /rest/api/2/issue/{issueKey}: ticket details, comments, attachments, and linked issues.
- GET /rest/api/2/search: assigned tickets using assignee = currentUser() ORDER BY updated DESC.

The app never calls Jira create, update, comment, transition, or delete endpoints.

## AI provider setup

Choose one in Configure: Gemini CLI terminal sign-in, OpenAI Codex CLI terminal sign-in, Claude CLI terminal sign-in, OpenAI API key, or Gemini API key.

Only ticket sections selected under Include in AI context are sent to the selected provider after clicking Generate briefing and plan. Use Preview prompt first if needed.

## Manual environment configuration

JIRA_BASE_URL=https://jira.your-company.example
JIRA_PAT=
AI_PROVIDER=gemini_cli
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash

Optional terminal CLI overrides: GEMINI_CLI_PATH, CODEX_CLI_PATH, and CLAUDE_CLI_PATH.

## Verification

Use Test connection to check Jira access and provider readiness. Run npm test and npm run build.