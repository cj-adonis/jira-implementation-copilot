import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const destination = process.argv[2];
if (!destination) throw new Error('Pass the release directory. Use npm run package:windows.');
const api = JSON.parse(await readFile('apps/api/package.json', 'utf8'));
await build({
  entryPoints: ['apps/api/src/server.ts'],
  outfile: resolve(destination, 'apps/api/dist/server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Bundle workspace TypeScript; keep npm packages intact, including their assets/licenses.
  external: Object.keys(api.dependencies).filter(name => name !== '@jira-copilot/shared'),
});
