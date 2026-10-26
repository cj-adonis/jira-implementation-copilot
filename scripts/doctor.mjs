import { access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = process.cwd();
const { default: dotenv } = await import('dotenv');
dotenv.config({ path: resolve(root, '.env') });
const run = promisify(execFile);
const installed = path => access(path).then(() => true).catch(() => false);
const skillFolders = process.env.MANAGING_JIRA_SKILL_PATH ? [process.env.MANAGING_JIRA_SKILL_PATH] : [join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.agents', 'skills', 'managing-jira'), join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.codex', 'skills', 'managing-jira')].filter(Boolean);
const skill = (await Promise.all(skillFolders.map(async folder => ({ folder, ok: await installed(join(folder, 'scripts', 'atlassian.py')) })))).find(x => x.ok);
const python = process.env.MANAGING_JIRA_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
let pyVersion = '';
try { const { stdout, stderr } = await run(python, [...(python === 'py' ? ['-3'] : []), '--version'], { timeout: 8000, windowsHide: true }); pyVersion = (stdout || stderr).trim(); } catch {}
const checks = [
  ['Node.js', Number(process.versions.node.split('.')[0]) >= 20, process.version],
  ['Dependencies', await installed(resolve(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc')), 'Run npm ci if missing'],
  ['managing-jira skill', Boolean(skill), skill?.folder ?? 'Install skill or set MANAGING_JIRA_SKILL_PATH'],
  ['Python 3.10+', /^Python 3\.(1[0-9]|[2-9][0-9])\./.test(pyVersion), pyVersion || 'Install Python or set MANAGING_JIRA_PYTHON']
];
for (const [name, ok, detail] of checks) console.log(`${ok ? 'OK' : 'CHECK'}  ${name}${detail ? ` - ${detail}` : ''}`);
console.log('\nJira MX is fixed. Select Connect Jira to sign in with Samsung SSO.');
