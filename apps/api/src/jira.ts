import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { batchStatusUpdateSchema, quickActionSchema, type EditOptions, type QuickAction, type QuickActionResult, ticketSchema, transitionsSchema, type StatusUpdate, type StatusUpdateResult, issueKeySchema, issueSchema, jiraStatusSchema, type JiraStatus, type ConnectionProgress, type Issue } from '@jira-copilot/shared';
import { config } from './config.js';

const exec = promisify(execFile);
export class AppError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
const text = (v: unknown): string | null => typeof v === 'string' ? v : v ? JSON.stringify(v) : null;
const person = (v: any) => v ? { displayName: typeof v === 'string' ? v : v.displayName ?? v.name ?? null, accountId: typeof v === 'string' ? null : v.accountId ?? null } : null;
export function normalizeTicket(raw: any) {
  const f = raw.fields ?? raw;
  const status = typeof f.status === 'string' ? f.status : f.status?.name ?? null;
  const statusCategory = f.status?.statusCategory?.key ?? f.statusCategory ?? null;
  const reasons: string[] = [];
  if (/\b(blocked|impeded|impediment)\b/i.test(status ?? '') && !/not blocked/i.test(status ?? '')) reasons.push('Status: ' + status);
  if ((f.labels ?? []).some((label: string) => /^(blocked|impediment)$/i.test(label))) reasons.push('Marked blocked in Jira labels');
  for (const link of f.issuelinks ?? []) {
    if (!link.inwardIssue || !/blocked by/i.test(link.type?.inward ?? '')) continue;
    const blocker = link.inwardIssue;
    const state = blocker.fields?.status;
    if (state?.statusCategory?.key === 'done' || /^(done|closed|resolved|cancelled|canceled)$/i.test(state?.name ?? '')) continue;
    reasons.push(state ? 'Blocked by ' + blocker.key : 'Blocking link: ' + blocker.key + ' (status unavailable)');
  }
  return ticketSchema.parse({ key: raw.key, summary: f.summary ?? '', status, statusCategory,
    priority: typeof f.priority === 'string' ? f.priority : f.priority?.name ?? null,
    dueDate: f.duedate ?? f.dueDate ?? null, updated: f.updated ?? null,
    assignee: person(f.assignee)?.displayName ?? null, blocked: reasons.length > 0, blockedReasons: reasons });
}
export function cleanupWiki(v: string | null): string | null { return v?.replace(/\{code(?::[^}]*)?\}/gi, '```').replace(/\{noformat\}/gi, '```').replace(/\[([^\]|]+)\|[^\]]+\]/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\{[^}]+\}/g, '').trim() || null; }
export function normalizeIssue(raw: any, baseUrl: string | null = null): Issue {
  const f = raw.fields ?? raw, comments = raw.comments ?? f.comment?.comments ?? [], links = f.issuelinks ?? [];
  return issueSchema.parse({
    ...normalizeTicket(raw),
    key: raw.key, browseUrl: baseUrl ? baseUrl + '/browse/' + raw.key : null, summary: f.summary ?? '',
    description: cleanupWiki(text(f.description)), issueType: f.issuetype?.name ?? null,
    status: typeof f.status === 'string' ? f.status : f.status?.name ?? null, priority: typeof f.priority === 'string' ? f.priority : f.priority?.name ?? null,
    components: (f.components ?? []).map((x: any) => x.name).filter(Boolean), labels: f.labels ?? [],
    reporter: person(f.reporter), assignee: person(f.assignee), created: f.created ?? null, updated: f.updated ?? null,
    comments: comments.map((x: any) => ({ id: x.id ?? null, author: typeof x.author === 'string' ? x.author : x.author?.displayName ?? null, body: cleanupWiki(text(x.body)) ?? '', created: x.created ?? null })),
    attachments: (f.attachment ?? []).map((x: any) => ({ filename: x.filename, mimeType: x.mimeType ?? null })),
    linkedIssues: links.map((x: any) => { const i = x.outwardIssue ?? x.inwardIssue; return { key: i?.key ?? 'unknown', summary: i?.fields?.summary ?? null, relationship: x.type?.outward ?? x.type?.inward ?? null }; }).filter((x: any) => x.key !== 'unknown')
  });
}
const sites = ['default', 'mx', 'nw', 'eu'] as const;
export type JiraSite = typeof sites[number];
export const isJiraSite = (v: unknown): v is JiraSite => sites.includes(v as JiraSite);
async function skill() {
  const candidates = process.env.MANAGING_JIRA_SKILL_PATH ? [process.env.MANAGING_JIRA_SKILL_PATH] : [join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.agents', 'skills', 'managing-jira'), join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.codex', 'skills', 'managing-jira')].filter(Boolean) as string[];
  for (const root of candidates) { const script = resolve(root, 'scripts', 'atlassian.py'); try { await access(script); return { root: resolve(root), script }; } catch {} }
  throw new AppError(503, 'managing-jira is not installed. Set MANAGING_JIRA_SKILL_PATH to its folder.');
}
const py = () => process.env.MANAGING_JIRA_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
// The Windows py launcher adds about a second to every CLI start. Look up the interpreter it
// would pick once in the background, then run that file directly. Until the lookup succeeds,
// the launcher keeps working exactly as before.
let directPython: string | null = null;
let directPythonLookup: Promise<void> | null = null;
function lookupDirectPython(): Promise<void> {
  directPythonLookup ??= new Promise<void>(done => {
    execFile('py', ['-0p'], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      const newest = error ? undefined : [...String(stdout).matchAll(/-V:3\.(\d+)\S*\s+\*?\s*(.+?python\.exe)\s*$/gim)]
        .sort((a, b) => Number(b[1]) - Number(a[1]))[0];
      if (!newest) return done();
      access(newest[2]).then(() => { directPython = newest[2]; }, () => undefined).finally(done);
    });
  });
  return directPythonLookup;
}
const pyCommand = () => (py() === 'py' && directPython) || py();
const pyArgs = (script: string, args: string[]) => [...(py() === 'py' && !directPython ? ['-3'] : []), script, ...args];
let pending: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> { const next = pending.then(fn, fn); pending = next.catch(() => undefined); return next; }
export function cliError(stderr: string): AppError {
  for (const line of stderr.trim().split(/\r?\n/).reverse()) {
    try {
      const value = JSON.parse(line);
      if (typeof value.error !== 'string') continue;
      const http = /\bHTTP\s+(\d{3})\b/i.exec(value.error);
      const code = http ? Number(http[1]) : /login window timed out/i.test(value.error) ? 504 : /session expired|not logged in|not signed in/i.test(value.error) ? 401 : 502;
      return new AppError([400, 401, 403, 404, 429, 503, 504].includes(code) ? code : 502, [value.error, value.hint].filter(v => typeof v === 'string' && v).join(' '));
    } catch { /* Ignore progress and non-JSON diagnostics. */ }
  }
  return new AppError(502, 'managing-jira could not complete the request. Check Python, the managed browser, and your VPN connection.');
}
export type JiraRunner = (args: string[], onInfo?: (message: string) => void) => Promise<any>;
export async function runJiraCli(args: string[], onInfo?: (message: string) => void): Promise<any> {
    const { script } = await skill();
    if (py() === 'py') void lookupDirectPython();
    return new Promise((resolve, reject) => {
      const loginAdapter = fileURLToPath(new URL('../../../scripts/jira-login.py', import.meta.url));
      const searchAdapter = fileURLToPath(new URL('../../../scripts/jira-workspace.py', import.meta.url));
      const commandArgs = args[0] === 'login' ? pyArgs(loginAdapter, [script, ...args])
        : args[0] === 'jira' && ['search', 'get-issue'].includes(args[1]) ? pyArgs(searchAdapter, [script, ...args]) : pyArgs(script, args);
      const child = execFile(pyCommand(), commandArgs, {
        cwd: process.cwd(), timeout: args[0] === 'status' ? 30_000 : 420_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true
      }, (error, stdout, stderr) => {
        if (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            directPython = null; // A moved or removed interpreter falls back to the launcher.
            reject(new AppError(503, 'Python 3.10+ was not found. Set MANAGING_JIRA_PYTHON.'));
          }
          else if (error.killed) reject(new AppError(504, args[0] === 'status' ? 'Checking the Jira browser timed out. Check the managed browser and your VPN connection.' : args[0] === 'login' ? 'Jira SSO timed out. Check the managed Chrome window.' : 'The Jira request timed out. Check your VPN connection and try again.'));
          else reject(cliError(String(stderr)));
          return;
        }
        try { resolve(JSON.parse(String(stdout))); }
        catch { reject(new AppError(502, 'managing-jira returned an invalid response.')); }
      });
      if (onInfo) {
        let remainder = '';
        child.stderr?.on('data', (chunk: Buffer) => {
          remainder += chunk.toString('utf8');
          const lines = remainder.split(/\r?\n/);
          remainder = lines.pop() ?? '';
          for (const line of lines) {
            try { const event = JSON.parse(line); if (typeof event.info === 'string') onInfo(event.info); }
            catch { /* ignore non-JSON diagnostics */ }
          }
        });
      }
    });
}
export async function jiraDiagnostics() { try { const { root } = await skill(); const { stdout } = await exec(py(), [...(py() === 'py' ? ['-3'] : []), '--version'], { timeout: 8_000, windowsHide: true }); return { available: true, detail: root + ' · ' + stdout.trim() }; } catch { return { available: false, detail: 'Install managing-jira and Python 3.10+' }; } }
export class JiraClient {
  constructor(private readonly run: JiraRunner = runJiraCli) {}
  private cachedStatus: { value: JiraStatus; expiresAt: number } | null = null;
  private loginTask: Promise<JiraStatus> | null = null;
  private statusTask: Promise<JiraStatus> | null = null;
  private progress: ConnectionProgress = { phase: 'idle', message: '', startedAt: null };
  private site(): JiraSite { if (!isJiraSite(config.jiraSite)) throw new AppError(503, 'Jira MX configuration is unavailable.'); return config.jiraSite; }
  connectionProgress() { return { ...this.progress }; }
  private parseStatus(value: unknown): JiraStatus {
    const parsed = jiraStatusSchema.safeParse(value);
    if (!parsed.success || !parsed.data.sites.some(entry => entry.service === 'jira' && entry.site === this.site())) {
      throw new AppError(502, 'managing-jira returned an invalid Jira MX session status.');
    }
    return parsed.data;
  }
  private signedIn(state: JiraStatus) { return state.sites.some(entry => entry.service === 'jira' && entry.site === this.site() && entry.logged_in); }
  private rememberStatus(value: JiraStatus) {
    this.cachedStatus = { value, expiresAt: Date.now() + 15_000 };
    return value;
  }
  private async readStatus(fresh = false) {
    if (!fresh && this.cachedStatus && Date.now() < this.cachedStatus.expiresAt) return this.cachedStatus.value;
    this.cachedStatus = null;
    return this.rememberStatus(this.parseStatus(await this.run(['status', '--service', 'jira', '--site', this.site()])));
  }
  status(fresh = false): Promise<JiraStatus> {
    if (!fresh && this.loginTask) return this.loginTask;
    if (!fresh && this.cachedStatus && Date.now() < this.cachedStatus.expiresAt) return Promise.resolve(this.cachedStatus.value);
    if (!this.statusTask) this.statusTask = serial(() => this.readStatus(fresh)).finally(() => { this.statusTask = null; });
    return this.statusTask;
  }
  login(): Promise<JiraStatus> {
    if (this.loginTask) return this.loginTask;
    const startedAt = Math.max(Date.now(), (this.progress.startedAt ?? 0) + 1);
    this.progress = { phase: 'checking', message: 'Checking the managed browser session...', startedAt };
    // Keep the entire login sequence together so reads cannot interrupt SSO.
    this.loginTask = serial(() => this.performLogin(startedAt)).finally(() => { this.loginTask = null; });
    return this.loginTask;
  }
  private async performLogin(startedAt: number): Promise<JiraStatus> {
    const site = this.site();
    this.progress = { phase: 'checking', message: 'Checking the managed browser session…', startedAt };
    try {
      const before = await this.readStatus();
      if (this.signedIn(before)) {
        this.progress = { phase: 'connected', message: 'Jira MX is connected.', startedAt };
        return before;
      }
      this.cachedStatus = null;
      this.progress = { phase: 'browser', message: 'Opening Jira MX in the managed Chrome window. Complete Samsung SSO there if prompted…', startedAt };
      const result = this.parseStatus(await this.run(['login', '--service', 'jira', '--site', site, '--headed'], message => {
        const phase = /opening a browser window|waiting for SSO login/i.test(message) ? 'browser' : 'automatic';
        this.progress = { phase, message, startedAt };
      }));
      if (!this.signedIn(result)) throw new AppError(401, 'SSO did not complete. Open Jira MX in the managed Chrome window and try Connect again.');
      this.rememberStatus(result);
      this.progress = { phase: 'connected', message: 'Jira MX is connected.', startedAt };
      return result;
    } catch (error) {
      this.cachedStatus = null;
      let failure = error instanceof AppError ? error : new AppError(502, 'Jira MX connection failed.');
      if (/login window timed out|Jira SSO timed out|SSO did not complete/i.test(failure.message)) {
        try {
          const after = await this.readStatus(true);
          if (this.signedIn(after)) {
            this.progress = { phase: 'connected', message: 'Jira MX is connected.', startedAt };
            return after;
          }
          failure = new AppError(504, 'Samsung SSO has not finished in the managed Chrome window. Complete sign-in there, then select Connect again.');
        } catch { /* keep the original failure if status is unavailable */ }
      }
      this.progress = { phase: 'error', message: failure.message, startedAt };
      throw failure;
    }
  }
  private command(name: string, args: string[] = []) {
    return serial(async () => {
      const site = this.site();
      const state = await this.readStatus();
      if (!this.signedIn(state)) throw new AppError(401, 'Not signed in to jira/' + site + '. Select Connect Jira to sign in.');
      try {
        return await this.run(['jira', name, '--site', site, ...args]);
      } catch (error) {
        // Never let a recent probe hide session expiry or a browser failure.
        this.cachedStatus = null;
        throw error;
      }
    });
  }
  async transitions(input: string) {
    const key = issueKeySchema.parse(input);
    return this.parseTransitions(await this.command('get-transitions', ['--key', key]));
  }
  private parseTransitions(raw: unknown) {
    const parsed = transitionsSchema.safeParse(raw);
    if (!parsed.success) throw new AppError(502, 'Jira returned invalid status choices. Refresh and try again.');
    return parsed.data;
  }
  async updateStatuses(input: StatusUpdate[]): Promise<{ results: StatusUpdateResult[] }> {
    const { updates } = batchStatusUpdateSchema.parse({ updates: input });
    // Keep validation and writes together; all commands share one browser session.
    return serial(async () => {
      const results: StatusUpdateResult[] = [];
      const site = this.site();
      let stopped = false;
      for (const update of updates) {
        if (stopped) {
          results.push({ key: update.key, outcome: 'skipped', message: 'Not attempted because the previous request lost its connection or had an uncertain outcome.' });
          continue;
        }
        let writeStarted = false;
        try {
          if (!this.signedIn(await this.readStatus(true))) throw new AppError(401, 'Not signed in to jira/' + site + '. Select Connect Jira to sign in.');
          const available = this.parseTransitions(await this.run(['jira', 'get-transitions', '--site', site, '--key', update.key]));
          const transition = available.transitions.find(item => item.id === update.transitionId);
          if (!transition) throw new AppError(400, 'This transition is no longer available. Refresh status choices and try again.');
          writeStarted = true;
          const response = await this.run(['jira', 'transition-issue', '--site', site, '--key', update.key, '--transition-id', transition.id]);
          if (response?.transitioned !== true) throw new AppError(502, 'Jira did not confirm the update.');
          results.push({ key: update.key, outcome: 'updated', message: 'Updated to ' + (transition.to ?? transition.name) + '.' });
        } catch (error) {
          this.cachedStatus = null;
          const failure = error instanceof AppError ? error : new AppError(502, 'Jira could not complete the request.');
          const uncertain = writeStarted && failure.statusCode >= 500;
          stopped = failure.statusCode === 401 || failure.statusCode === 429 || failure.statusCode >= 500;
          results.push({ key: update.key, outcome: uncertain ? 'unknown' : 'failed', message: uncertain
            ? 'The update may have reached Jira. Check the current status before trying again. ' + failure.message
            : failure.message });
        }
      }
      return { results };
    });
  }
  async baseUrl() { const { root } = await skill(); const cfg = JSON.parse(await readFile(join(root, 'scripts', 'config', 'sites.json'), 'utf8')); return cfg.jira?.[this.site()] ?? null; }
  private parseEditOptions(raw: any): EditOptions {
    const fields = raw.editmeta?.fields;
    if (!fields || typeof fields !== 'object') throw new AppError(502, 'Jira did not return editable fields for this issue. Open it in Jira to make changes.');
    return { priorities: (fields.priority?.allowedValues ?? []).filter((item: any) => /^\d{1,20}$/.test(String(item.id)) && typeof item.name === 'string').map((item: any) => ({ id: String(item.id), name: item.name })),
      dueDateEditable: Boolean(fields.duedate), priority: typeof raw.priority === 'string' ? raw.priority : raw.priority?.name ?? null, dueDate: raw.duedate ?? null };
  }
  async editOptions(input: string) {
    const key = issueKeySchema.parse(input);
    return this.parseEditOptions(await this.command('get-issue', ['--key', key, '--fields', 'summary,priority,duedate', '--expand', 'editmeta']));
  }
  async quickAction(input: string, value: QuickAction): Promise<QuickActionResult> {
    const key = issueKeySchema.parse(input), action = quickActionSchema.parse(value);
    return serial(async () => {
      const site = this.site();
      let writeStarted = false;
      try {
        if (!this.signedIn(await this.readStatus(true))) throw new AppError(401, 'Not signed in to jira/' + site + '. Select Connect Jira to sign in.');
        let command: string[];
        if (action.action === 'comment') command = ['jira', 'add-comment', '--site', site, '--key', key, '--body', action.body];
        else {
          const options = this.parseEditOptions(await this.run(['jira', 'get-issue', '--site', site, '--key', key, '--fields', 'summary,priority,duedate', '--expand', 'editmeta']));
          if (action.action === 'priority' && !options.priorities.some(item => item.id === action.priorityId)) throw new AppError(400, 'That priority is no longer available. Close this editor and refresh the issue.');
          if (action.action === 'dueDate' && !options.dueDateEditable) throw new AppError(403, 'The due date cannot be edited here. Open this issue in Jira.');
          const fields = action.action === 'priority' ? { priority: { id: action.priorityId } } : { duedate: action.dueDate };
          command = ['jira', 'update-issue', '--site', site, '--key', key, '--fields', JSON.stringify(fields)];
        }
        writeStarted = true;
        const result = await this.run(command);
        if (action.action === 'comment' ? !result?.id : result?.updated !== true) throw new AppError(502, 'Jira did not confirm the change.');
        return { outcome: 'updated', message: action.action === 'comment' ? 'Comment added.' : action.action === 'priority' ? 'Priority updated.' : action.dueDate ? 'Due date updated.' : 'Due date cleared.' };
      } catch (error) {
        this.cachedStatus = null;
        const failure = error instanceof AppError ? error : new AppError(502, 'Jira could not complete this request.');
        if (failure.statusCode === 401 && !writeStarted) throw failure;
        return { outcome: writeStarted && failure.statusCode >= 500 ? 'unknown' : 'failed', message: writeStarted && failure.statusCode >= 500
          ? 'This change may have reached Jira. Check the issue before trying again. ' + failure.message : failure.message };
      }
    });
  }
  async getIssue(input: string): Promise<Issue> { const key = issueKeySchema.parse(input); const raw = await this.command('get-issue', ['--key', key, '--fields', 'summary,description,issuetype,status,priority,duedate,components,labels,reporter,assignee,created,updated,comment,attachment,issuelinks']); return normalizeIssue(raw, await this.baseUrl()); }
  async getAssignedIssues(filters: { status?: string; project?: string; priority?: string; label?: string; updatedDays?: number } = {}) {
    const terms = ['assignee = currentUser()']; if (filters.status) terms.push('status = ' + JSON.stringify(filters.status)); if (filters.project) terms.push('project = ' + JSON.stringify(filters.project)); if (filters.priority) terms.push('priority = ' + JSON.stringify(filters.priority)); if (filters.label) terms.push('labels = ' + JSON.stringify(filters.label)); if (filters.updatedDays) terms.push('updated >= -' + filters.updatedDays + 'd');
    const issues: any[] = [];
    let startAt = 0;
    while (true) {
      const data = await this.command('search', ['--jql', terms.join(' AND ') + ' ORDER BY updated DESC', '--fields', 'summary,status,priority,duedate,resolution,assignee,updated,labels,issuelinks', '--maxResults', '50', '--startAt', String(startAt)]);
      const page = data.issues ?? [];
      issues.push(...page);
      startAt += page.length;
      if (!page.length || (typeof data.total === 'number' ? startAt >= data.total : page.length < 50)) break;
    }
    return [...new Map(issues.map(i => [i.key, normalizeTicket(i)])).values()];
  }
  async commentActivity(keys: string[]) {
    const out = [];
    for (const input of keys) {
      const key = issueKeySchema.parse(input);
      try {
        const raw = await this.command('get-issue', ['--key', key, '--fields', 'comment']);
        const comments = normalizeIssue({ ...raw, key }).comments;
        const latest = comments.reduce<Issue['comments'][number] | null>((last, comment) =>
          !last || (Date.parse(comment.created ?? '') || 0) >= (Date.parse(last.created ?? '') || 0) ? comment : last, null);
        out.push({ key, count: comments.length, comments, latest });
      } catch (error) {
        if (!(error instanceof AppError) || ![403, 404].includes(error.statusCode)) throw error;
        out.push({ key, count: 0, comments: [], latest: null, error: error.message });
      }
    }
    return out;
  }
  async insights(input: string) { const key = issueKeySchema.parse(input); const names = ['get-issue-dates', 'get-issue-watchers', 'get-worklog', 'get-transitions'] as const; const data: any = {}; for (const name of names) { try { data[name] = await this.command(name, ['--key', key]); } catch (error) { if (!(error instanceof AppError) || ![403, 404].includes(error.statusCode)) throw error; data[name] = null; } } return { dates: data['get-issue-dates'], watchers: data['get-issue-watchers'], worklog: data['get-worklog'], transitions: data['get-transitions'] }; }
  async boards(project?: string) { return this.command('get-agile-boards', project ? ['--projectKeyOrId', project] : []); }
  async sprints(boardId: number) { return this.command('get-sprints-from-board', ['--board-id', String(boardId), '--state', 'active']); }
}
