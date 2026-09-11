import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const checks = [
  ['Node.js', true, process.version],
  ['Dependencies', await access(resolve(root, 'node_modules')).then(() => true).catch(() => false), 'Run npm install if missing'],
  ['Local .env', await access(resolve(root, '.env')).then(() => true).catch(() => false), 'Use the first-run setup screen if missing'],
  ['Gemini CLI bundle', await access(resolve(process.env.APPDATA ?? '', 'npm', 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js')).then(() => true).catch(() => false), 'Optional: needed only for Gemini CLI provider'],
  ['Codex CLI bundle', await access(resolve(process.env.APPDATA ?? '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')).then(() => true).catch(() => false), 'Optional: needed only for Codex CLI provider'],
  ['Claude CLI', await access(resolve(process.env.USERPROFILE ?? '', '.local', 'bin', 'claude.exe')).then(() => true).catch(() => false), 'Optional: needed only for Claude CLI provider']
];
for (const [name, ok, detail] of checks) console.log(`${ok ? 'OK' : 'CHECK'}  ${name}${detail ? ` - ${detail}` : ''}`);
console.log('\nOpen the app, complete first-run setup, then use Show diagnostics to confirm the selected provider.');
