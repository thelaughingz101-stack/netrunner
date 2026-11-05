import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { secretStatus } from '../../config/store.js';
import { EDITABLE, keyStatus, openEnvFile, updateEnvFile, type EditableKey } from '../../secrets.js';
import { vaultStorage } from '../../vault.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Keys (and the local AI's setup) can only be changed from this PC: never from another device on the LAN (HOST=0.0.0.0). */
export function localOnly(req: FastifyRequest, what = 'API keys') {
  if (!LOOPBACK.has(req.ip)) throw Object.assign(new Error(`${what} can only be changed on the PC running NetRunner`), { statusCode: 403 });
}

const Updates = z.partialRecord(z.enum(Object.keys(EDITABLE) as [EditableKey, ...EditableKey[]]), z.string().trim().max(2000));

export async function keyRoutes(app: FastifyInstance) {
  app.get('/keys', async () => ({ keys: keyStatus(), keyStorage: vaultStorage() }));

  app.put('/keys', async req => {
    localOnly(req);
    updateEnvFile(Updates.parse(req.body));
    return { keys: keyStatus(), secrets: secretStatus(), keyStorage: vaultStorage() };
  });

  app.post('/keys/open', async req => {
    localOnly(req);
    openEnvFile(z.object({ how: z.enum(['file', 'folder']) }).parse(req.body).how);
    return { ok: true };
  });
}
