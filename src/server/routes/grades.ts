import type { FastifyInstance } from 'fastify';
import { getConfig } from '../../config/store.js';
import { db } from '../../db/db.js';
import { digestById } from '../../digests.js';
import { log } from '../../logger.js';
import { feedHealth } from '../../pipeline/feedHealth.js';
import { getGrade, gradable, gradeDigest, saveGrade } from '../../pipeline/grade/index.js';
import type { Tier } from '../../pipeline/llm/types.js';

export async function gradeRoutes(app: FastifyInstance) {
  // The grader's full report on a digest (Output tab).
  app.get<{ Params: { id: string } }>('/digests/:id/grade', async (req, reply) =>
    getGrade(Number(req.params.id)) ?? reply.code(404).send({ error: 'not graded yet' }));

  // "Grade this digest": for digests made before the grader existed, or to grade one again. Uses the
  // settings saved now (the ones the digest was written with aren't kept), and says so in the report.
  app.post<{ Params: { id: string } }>('/digests/:id/grade', async (req, reply) => {
    const d = digestById(Number(req.params.id));
    if (!d) return reply.code(404).send({ error: 'not found' });
    if (!gradable(d.mode)) return reply.code(422).send({ error: 'Only morning and nightly digests can be graded.' });
    const run = d.runId ? db().prepare('SELECT stats_json, llm_tier FROM runs WHERE id = ?').get(d.runId) as { stats_json: string | null; llm_tier: string | null } | undefined : undefined;
    const report = await gradeDigest({
      content: d.content,
      config: getConfig().config,
      runStats: run?.stats_json ? JSON.parse(run.stats_json) : null,
      writerTier: (run?.llm_tier ?? undefined) as Tier | undefined,
      notes: ['Graded afterwards, against your settings as they are now.'],
    }, { log });
    saveGrade(d.id, d.runId, report);
    return report;
  });

  // Feed health (Sources tab): feeds that are failing, empty, or have gone quiet.
  app.get('/feeds/health', async () => feedHealth(getConfig().config));
}
