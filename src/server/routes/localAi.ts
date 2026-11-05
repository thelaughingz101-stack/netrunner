import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getConfig } from '../../config/store.js';
import { localAiStatus, pullState, startOllama, startPull, testModel } from '../../localAi.js';
import { localOnly } from './keys.js';

// AI Writer → Local AI. Starting Ollama and downloading models change this computer, so like the keys they
// only work from it; looking and testing work from anywhere the app does.
export async function localAiRoutes(app: FastifyInstance) {
  app.get('/local-ai', async () => localAiStatus());

  app.post('/local-ai/start', async req => {
    localOnly(req, 'The local AI');
    return startOllama();
  });

  app.post('/local-ai/pull', async req => {
    localOnly(req, 'The local AI');
    return startPull(z.object({ name: z.string().trim().min(1).max(200) }).parse(req.body).name);
  });

  app.get('/local-ai/pull', async () => ({ pull: pullState() }));

  app.post('/local-ai/test', async () => testModel(getConfig().config.format.summaryLength));
}
