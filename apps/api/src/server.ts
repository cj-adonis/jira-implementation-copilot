import { createApp } from './app.js';
import { config } from './config.js';
import { registerWeb } from './web.js';

const app = createApp();
await registerWeb(app);
await app.listen({ port: config.port, host: '127.0.0.1' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void app.close().then(() => process.exit(0)); });
}

// Closing the launcher (including an unexpected exit) closes this pipe.
if (process.env.JIRA_DESKTOP === '1') {
  process.stdin.resume();
  process.stdin.on('end', () => {
    const timeout = setTimeout(() => process.exit(0), 3000);
    timeout.unref();
    void app.close().then(() => process.exit(0));
  });
}
