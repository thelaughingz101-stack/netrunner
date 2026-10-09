import type { FastifyInstance } from 'fastify';
import { uiCatalog } from '../../catalog/index.js';
import { getConfig, saveConfig, secretStatus } from '../../config/store.js';
import { keyStatus } from '../../secrets.js';

export async function configRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true, service: 'netrunner', time: new Date().toISOString() }));

  app.get('/catalog', async () => uiCatalog());

  app.get('/config', async () => {
    const { config, version } = getConfig();
    return { config, version, secrets: secretStatus(), keys: keyStatus() };
  });

  app.put('/config', async req => {
    const { config, version } = saveConfig(req.body);
    return { config, version, secrets: secretStatus() };
  });
}
