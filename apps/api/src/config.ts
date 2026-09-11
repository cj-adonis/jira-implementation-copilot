import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
dotenv.config({ path: envPath });
type Provider = 'openai' | 'gemini' | 'gemini_cli' | 'codex_cli' | 'claude_cli';
type SettingsInput = { jiraBaseUrl?: string; jiraPat?: string; provider: Provider; openaiKey?: string; openaiModel?: string; geminiKey?: string; geminiModel?: string };
const optional = (value?: string) => value?.trim() || undefined;
const configuredProvider: Provider = ['gemini_cli', 'codex_cli', 'claude_cli', 'gemini'].includes(process.env.AI_PROVIDER ?? '') ? process.env.AI_PROVIDER as Provider : 'openai';
export const config = { port: Number(process.env.PORT ?? 3001), jiraBaseUrl: optional(process.env.JIRA_BASE_URL)?.replace(/\/$/, ''), jiraPat: optional(process.env.JIRA_PAT), provider: configuredProvider, openaiKey: optional(process.env.OPENAI_API_KEY), openaiModel: optional(process.env.OPENAI_MODEL) ?? 'gpt-4.1-mini', geminiKey: optional(process.env.GEMINI_API_KEY), geminiModel: optional(process.env.GEMINI_MODEL) ?? 'gemini-2.0-flash' };
const terminalProvider = () => ['gemini_cli', 'codex_cli', 'claude_cli'].includes(config.provider);
export const readiness = () => ({ jira: Boolean(config.jiraBaseUrl && config.jiraPat), ai: config.provider === 'openai' ? Boolean(config.openaiKey) : terminalProvider() ? true : Boolean(config.geminiKey), provider: config.provider, model: config.provider === 'openai' ? config.openaiModel : terminalProvider() ? 'terminal default' : config.geminiModel });
export async function saveSettings(input: SettingsInput) {
 const jiraBaseUrl=optional(input.jiraBaseUrl); if(jiraBaseUrl){new URL(jiraBaseUrl);config.jiraBaseUrl=jiraBaseUrl.replace(/\/$/,'');} const jiraPat=optional(input.jiraPat);if(jiraPat)config.jiraPat=jiraPat;config.provider=input.provider;
 const openaiKey=optional(input.openaiKey);if(openaiKey)config.openaiKey=openaiKey;const geminiKey=optional(input.geminiKey);if(geminiKey)config.geminiKey=geminiKey;const openaiModel=optional(input.openaiModel);if(openaiModel)config.openaiModel=openaiModel;const geminiModel=optional(input.geminiModel);if(geminiModel)config.geminiModel=geminiModel;
 const rows=[['JIRA_BASE_URL',config.jiraBaseUrl],['JIRA_PAT',config.jiraPat],['AI_PROVIDER',config.provider],['OPENAI_API_KEY',config.openaiKey],['OPENAI_MODEL',config.openaiModel],['GEMINI_API_KEY',config.geminiKey],['GEMINI_MODEL',config.geminiModel]].filter(([,v])=>v).map(([k,v])=>`${k}=${JSON.stringify(v)}`);await writeFile(envPath,`${rows.join('\n')}\n`,{encoding:'utf8',mode:0o600});return readiness();
}