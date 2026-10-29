import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The packaged API keeps the same relative paths as the source tree.
export async function registerWeb(app: FastifyInstance, root = fileURLToPath(new URL('../../web/dist/', import.meta.url))) {
  if (!existsSync(root)) return;
  await app.register(fastifyStatic, { root, index: ['index.html'], cacheControl: false });
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0];
    if ((request.method === 'GET' || request.method === 'HEAD') && !path.startsWith('/api/') && !path.startsWith('/assets/') && !path.includes('.')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found.' });
  });
}
