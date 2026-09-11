import { realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from './jira.js';

const execFileAsync = promisify(execFile);
export async function startImplementation(repositoryPath: string, issueKey: string) {
  let repository: string;
  try { repository = await realpath(repositoryPath); } catch { throw new AppError(400, 'The repository folder does not exist.'); }
  try { await execFileAsync('git', ['-C', repository, 'rev-parse', '--is-inside-work-tree'], { timeout: 10_000, windowsHide: true }); } catch { throw new AppError(400, 'The selected folder is not a Git repository.'); }
  const branch = `feature/${issueKey.toLowerCase()}-implementation`;
  try { await execFileAsync('git', ['-C', repository, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { timeout: 10_000, windowsHide: true }); throw new AppError(409, `Branch ${branch} already exists. Switch to it manually or choose another repository.`); } catch (error) { if (error instanceof AppError) throw error; }
  try { await execFileAsync('git', ['-C', repository, 'switch', '-c', branch], { timeout: 20_000, windowsHide: true }); } catch { throw new AppError(500, 'Git could not create the implementation branch. Check for uncommitted conflicts and try again.'); }
  return { repository, branch };
}
