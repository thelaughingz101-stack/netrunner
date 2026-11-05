import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { deleteDigest, listDigests, saveDigest, searchDigests } from '../../digests.js';
import { resolveYoutube } from '../../sources/youtubeResolve.js';
import { resolveFeed } from '../../sources/feedResolve.js';
import { resolveBluesky } from '../../sources/blueskyResolve.js';

const NewDigest = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.string().min(1).max(40),
  content: z.string().min(1),
});

export async function digestRoutes(app: FastifyInstance) {
  app.get('/digests', async () => ({ digests: listDigests() }));

  // Output tab search across every saved digest (the list only holds the newest 300).
  app.get<{ Querystring: { q?: string } }>('/digests/search', async req => ({ hits: searchDigests(String(req.query.q ?? '').slice(0, 200)) }));

  app.post('/digests', async req => {
    const d = NewDigest.parse(req.body);
    return { id: saveDigest({ ...d, source: 'upload' }) };
  });

  app.delete<{ Params: { id: string } }>('/digests/:id', async (req, reply) => {
    const ok = deleteDigest(Number(req.params.id));
    return ok ? { ok } : reply.code(404).send({ error: 'not found' });
  });

  // Add your own → Bluesky: checks the account exists before it's saved.
  app.post('/resolve-bluesky', async (req, reply) => {
    const { query } = z.object({ query: z.string().max(300) }).parse(req.body);
    const result = await resolveBluesky(query);
    return 'error' in result ? reply.code(422).send(result) : result;
  });

  // Add your own → RSS: checks the feed (or finds a site's feed) before it's saved.
  app.post('/resolve-feed', async (req, reply) => {
    const { query } = z.object({ query: z.string().max(2000) }).parse(req.body);
    const result = await resolveFeed(query);
    return 'error' in result ? reply.code(422).send(result) : result;
  });

  app.post('/resolve-youtube', async (req, reply) => {
    const { query } = z.object({ query: z.string() }).parse(req.body);
    const result = await resolveYoutube(query);
    return 'error' in result ? reply.code(422).send(result) : result;
  });
}
