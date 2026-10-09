import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deleteDigest, listDigests, saveDigest } from '../../digests.js';
import { resolveYoutube } from '../../sources/youtubeResolve.js';

const NewDigest = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.string().min(1).max(40),
  content: z.string().min(1),
});

export async function digestRoutes(app: FastifyInstance) {
  app.get('/digests', async () => ({ digests: listDigests() }));

  app.post('/digests', async req => {
    const d = NewDigest.parse(req.body);
    return { id: saveDigest({ ...d, source: 'upload' }) };
  });

  app.delete<{ Params: { id: string } }>('/digests/:id', async (req, reply) => {
    const ok = deleteDigest(Number(req.params.id));
    return ok ? { ok } : reply.code(404).send({ error: 'not found' });
  });

  app.post('/resolve-youtube', async (req, reply) => {
    const { query } = z.object({ query: z.string() }).parse(req.body);
    const result = await resolveYoutube(query);
    return 'error' in result ? reply.code(422).send(result) : result;
  });
}
