import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();
await app.listen({ port: config.port, host: '127.0.0.1' });
