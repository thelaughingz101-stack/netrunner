import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { secretStatus } from '../../config/store.js';
import { EDITABLE, keyStatus, openEnvFile, updateEnvFile, type EditableKey } from '../../secrets.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Keys can only be changed from this PC: never from another device on the LAN (HOST=0.0.0.0). */
function localOnly(req: FastifyRequest) {
  if (!LOOPBACK.has(req.ip)) throw Object.assign(new Error('API keys can only be changed on the PC running NetRunner'), { statusCode: 403 });
}

const Updates = z.partialRecord(z.enum(Object.keys(EDITABLE) as [EditableKey, ...EditableKey[]]), z.string().trim().max(2000));

export async function keyRoutes(app: FastifyInstance) {
  app.get('/keys', async () => ({ keys: keyStatus() }));

  app.put('/keys', async req => {
    localOnly(req);
    updateEnvFile(Updates.parse(req.body));
    return { keys: keyStatus(), secrets: secretStatus() };
  });

  app.post('/keys/open', async req => {
    localOnly(req);
    openEnvFile(z.object({ how: z.enum(['file', 'folder']) }).parse(req.body).how);
    return { ok: true };
  });
}
