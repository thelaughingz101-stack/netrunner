import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LOOKBACKS } from '../../config/schema.js';
import { currentRun, run, runPrompt } from '../../pipeline/run.js';
import { getRun, listRuns } from '../../pipeline/runs.js';
import { nextRuns } from '../../scheduler.js';

const RunBody = z.object({
  lookbackWindow: z.enum(LOOKBACKS).optional(),
  forceMode: z.enum(['morning', 'nightly', 'weekly', 'monthly']).optional(),
  dryRun: z.boolean().optional(),
}).default({});

export async function runRoutes(app: FastifyInstance) {
  // "Run News Digest" — same response shape the UI read from the n8n webhook ({ digest, mode, date }).
  app.post('/run', async req => {
    const body = RunBody.parse(req.body ?? {});
    const out = await run({ trigger: 'api', ...body });
    if (out.kind === 'skipped') return { skipped: true, reason: out.reason };
    return out;
  });

  // "Generate Prompt" — Manual mode, same shape as n8n's Format Manual Output.
  app.post('/prompt', async req => {
    const body = RunBody.parse(req.body ?? {});
    return runPrompt({ trigger: 'api', ...body, forceMode: body.forceMode === 'morning' || body.forceMode === 'nightly' ? body.forceMode : undefined });
  });

  app.get('/runs', async () => ({ running: currentRun(), next: await nextRuns(), runs: listRuns() }));
  app.get<{ Params: { id: string } }>('/runs/:id', async (req, reply) => getRun(req.params.id) ?? reply.code(404).send({ error: 'not found' }));
}
