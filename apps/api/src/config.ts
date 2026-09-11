import dotenv from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env');
dotenv.config({ path: envPath });
export type Provider = 'openai' | 'gemini' | 'gemini_cli' | 'codex_cli' | 'claude_cli';
type SettingsInput = { jiraBaseUrl?: string; jiraPat?: string; provider: Provider; openaiKey?: string; openaiModel?: string; geminiKey?: string; geminiModel?: string };
const optional = (value?: string) => value?.trim() || undefined;
const configuredProvider: Provider = ['gemini_cli', 'codex_cli', 'claude_cli', 'gemini'].includes(process.env.AI_PROVIDER ?? '') ? process.env.AI_PROVIDER as Provider : 'openai';
export const config = { port: Number(process.env.PORT ?? 3001), jiraBaseUrl: optional(process.env.JIRA_BASE_URL)?.replace(/\/$/, ''), jiraPat: optional(process.env.JIRA_PAT), provider: configuredProvider, openaiKey: optional(process.env.OPENAI_API_KEY), openaiModel: optional(process.env.OPENAI_MODEL) ?? 'gpt-4.1-mini', geminiKey: optional(process.env.GEMINI_API_KEY), geminiModel: optional(process.env.GEMINI_MODEL) ?? 'gemini-2.0-flash' };
const terminalProvider = () => ['gemini_cli', 'codex_cli', 'claude_cli'].includes(config.provider);
export const readiness = () => ({ jira: Boolean(config.jiraBaseUrl && config.jiraPat), ai: config.provider === 'openai' ? Boolean(config.openaiKey) : terminalProvider() ? true : Boolean(config.geminiKey), provider: config.provider, model: config.provider === 'openai' ? config.openaiModel : terminalProvider() ? 'terminal default' : config.geminiModel });

async function commandAvailable(command: string, args = ['--version']) { try { const { stdout } = await execFileAsync(command, args, { timeout: 8_000, windowsHide: true }); return { available: true, detail: stdout.trim().split(/\r?\n/)[0] || 'Installed' }; } catch { return { available: false, detail: 'Not found or could not run' }; } }
async function nodeCliAvailable(path: string) { try { await access(path); return await commandAvailable(process.execPath, [path, '--version']); } catch { return { available: false, detail: 'Not installed' }; } }
export async function diagnostics() { const geminiPath=process.env.GEMINI_CLI_PATH??resolve(process.env.APPDATA??'', 'npm', 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js'); const codexPath=process.env.CODEX_CLI_PATH??resolve(process.env.APPDATA??'', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'); const claudePath=process.env.CLAUDE_CLI_PATH??resolve(process.env.USERPROFILE??'', '.local', 'bin', 'claude.exe'); const [gemini, codex, claude] = await Promise.all([nodeCliAvailable(geminiPath), nodeCliAvailable(codexPath), commandAvailable(claudePath)]); return { node: { available: true, detail: process.version }, jira: { configured: Boolean(config.jiraBaseUrl && config.jiraPat), baseUrlConfigured: Boolean(config.jiraBaseUrl), tokenConfigured: Boolean(config.jiraPat) }, selectedProvider: config.provider, providers: { geminiCli: gemini, codexCli: codex, claudeCli: claude, openaiApi: { available: Boolean(config.openaiKey), detail: config.openaiKey ? `Configured (${config.openaiModel})` : 'API key not configured' }, geminiApi: { available: Boolean(config.geminiKey), detail: config.geminiKey ? `Configured (${config.geminiModel})` : 'API key not configured' } } }; }

export async function saveSettings(input: SettingsInput) {
 const jiraBaseUrl=optional(input.jiraBaseUrl); if(jiraBaseUrl){new URL(jiraBaseUrl);config.jiraBaseUrl=jiraBaseUrl.replace(/\/$/,'');} const jiraPat=optional(input.jiraPat);if(jiraPat)config.jiraPat=jiraPat;config.provider=input.provider;
 const openaiKey=optional(input.openaiKey);if(openaiKey)config.openaiKey=openaiKey;const geminiKey=optional(input.geminiKey);if(geminiKey)config.geminiKey=geminiKey;const openaiModel=optional(input.openaiModel);if(openaiModel)config.openaiModel=openaiModel;const geminiModel=optional(input.geminiModel);if(geminiModel)config.geminiModel=geminiModel;
 const rows=[['JIRA_BASE_URL',config.jiraBaseUrl],['JIRA_PAT',config.jiraPat],['AI_PROVIDER',config.provider],['OPENAI_API_KEY',config.openaiKey],['OPENAI_MODEL',config.openaiModel],['GEMINI_API_KEY',config.geminiKey],['GEMINI_MODEL',config.geminiModel]].filter(([,v])=>v).map(([k,v])=>`${k}=${JSON.stringify(v)}`);await writeFile(envPath,`${rows.join('\n')}\n`,{encoding:'utf8',mode:0o600});return readiness();
}
