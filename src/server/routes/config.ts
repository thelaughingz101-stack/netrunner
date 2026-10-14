import type { FastifyInstance } from 'fastify';
import { uiCatalog } from '../../catalog/index.js';
import { normalizeConfig } from '../../config/schema.js';
import { getConfig, saveConfig, secretStatus } from '../../config/store.js';
import { keyStatus } from '../../secrets.js';
import { vaultProblems, vaultStorage } from '../../vault.js';

export async function configRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true, service: 'netrunner', time: new Date().toISOString() }));

  app.get('/catalog', async () => uiCatalog());

  app.get('/config', async () => {
    const { config, version } = getConfig();
    return { config, version, secrets: secretStatus(), keys: keyStatus(), keyStorage: vaultStorage(), problems: vaultProblems() };
  });

  app.put('/config', async req => {
    const { config, version } = saveConfig(req.body);
    return { config, version, secrets: secretStatus() };
  });

  // Import settings: checks a file from Export settings (or an old n8n digest-config.json) and fills in
  // anything it's missing. Doesn't save: the UI shows the result and the user presses Save, like a template.
  app.post('/config/import', async (req, reply) => {
    const body = req.body as { app?: unknown; config?: unknown } | null;
    const raw = body && typeof body === 'object' && body.app === 'NetRunner' ? body.config : body;
    const isPlainObject = raw !== null && typeof raw === 'object' && !Array.isArray(raw);
    if (!isPlainObject || !CONFIG_SECTIONS.some(k => k in raw)) {
      return reply.code(400).send({ error: "That file isn't a NetRunner settings file. Use one made with Export settings." });
    }
    return { config: normalizeConfig(raw) };
  });
}

const CONFIG_SECTIONS = ['topics', 'sources', 'delivery', 'schedule', 'llm', 'format', 'filters', 'rollups', 'customSources'];
