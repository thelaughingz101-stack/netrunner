// Writes the digest: one AI call (+ coverage recovery) for a normal run, one per topic for a big one
// (split.ts plans the calls and stitches the answers). Spec: docs/superpowers/specs/2026-10-16-per-topic-digests-design.md.
import pLimit from 'p-limit';
import type { Config } from '../config/schema.js';
import { env } from '../env.js';
import { ID_RULE, stripSections, withIdRule } from './coverage/coverage.js';
import { ensureCoverage, recordItems, type CoverageOutcome, type CoverageStats } from './coverage/index.js';
import { AllTiersFailedError, generate, type EngineOptions } from './llm/engine.js';
import { attemptStage } from './llm/explain.js';
import type { AttemptLog, Tier } from './llm/types.js';
import { buildLlmPayload } from './prompt/index.js';
import { callConfig, failureNote, morningSlice, plainSections, planCalls, stitch, type CallPlan } from './split.js';
import type { Item, Mode, RunContext } from './types.js';

/** Calls in flight at once: Gemini's free tier allows about 10 requests a minute. */
const PARALLEL_CALLS = 3;

export interface WriteInput { mode: Mode; items: Item[]; morningDigest: string; developing: string[] }
export interface Written { digest: string; placements: CoverageOutcome['placements']; tier: Tier }

interface CallResult {
  digest: string;
  placements: CoverageOutcome['placements'];
  llm: { tier: Tier; model: string; finishReason: string | null; truncated: boolean; attempts: AttemptLog[] };
  coverage?: CoverageStats;
}

/** A topic call either wrote its part or every AI tier failed. */
type Outcome = { plan: CallPlan; r: CallResult } | { plan: CallPlan; err: AllTiersFailedError };

/** One AI call over these items, then the coverage check (recovery rounds) on its answer. */
async function writeOne(ctx: RunContext, config: Config, input: WriteInput, engine: EngineOptions): Promise<CallResult> {
  const prompt = withIdRule(buildLlmPayload({ mode: input.mode, items: input.items, morningDigest: input.morningDigest }, config, input.developing));
  const first = await generate({ kind: 'digest', prompt, idRule: ID_RULE }, config, ctx.log, engine);
  const llm = { tier: first.tier, model: first.model, finishReason: first.finishReason, truncated: first.truncated, attempts: first.attempts };
  if (!input.items.length) return { digest: first.text, placements: new Map(), llm };
  const cov = await ensureCoverage(ctx, input.items, prompt, first, engine);
  return { digest: cov.digest, placements: cov.placements, llm, coverage: cov.stats };
}

export async function writeDigest(ctx: RunContext, input: WriteInput, engine: EngineOptions): Promise<Written> {
  const plans = planCalls(input.items, ctx.config, env().LLM_ITEMS_PER_CALL);
  if (!plans) {
    const one = await writeOne(ctx, ctx.config, input, engine);
    ctx.stats.llm = one.llm;
    return { digest: one.digest, placements: one.placements, tier: one.llm.tier };
  }

  const total = plans.length;
  let done = 0;
  const progress = (extra = '') => ctx.progress?.(`Writing by topic: ${done} of ${total} done${extra}`);
  const label = (p: CallPlan) => (p.items.length ? p.topics.join(', ') : 'searches for the other topics');
  ctx.log.info({ calls: total, stories: input.items.length }, 'big digest: one AI call per topic');
  progress();

  // Nightly: each call gets this morning's sections for its own topics, so Story Updates covers every topic.
  const slices = plans.map(p => (input.morningDigest ? morningSlice(input.morningDigest, p.topics) : ''));
  // Story Updates comes only from calls that had a morning slice (their "nothing to update" lines would leak in
  // otherwise, worded any which way); with no slices at all, from the first call, so the section still exists.
  const keepUpdates = slices.some(Boolean) ? slices.map(Boolean) : plans.map((_, i) => i === 0);

  const limit = pLimit(PARALLEL_CALLS);
  const results = await Promise.all(plans.map((plan, i) => limit(async (): Promise<Outcome> => {
    const callEngine: EngineOptions = { ...engine, onAttempt: a => { engine.onAttempt?.(a); progress(` · ${label(plan)}: ${attemptStage(a)}`); } };
    try {
      // Developing stories cut across topics: the first call only, so they're reported once.
      const r = await writeOne(ctx, callConfig(ctx.config, plan), {
        mode: input.mode, items: plan.items, morningDigest: slices[i], developing: i === 0 ? input.developing : [],
      }, callEngine);
      return { plan, r };
    } catch (err) {
      if (!(err instanceof AllTiersFailedError)) throw err;
      ctx.log.warn({ topics: plan.topics, err: err.message }, 'topic call failed — listing its headlines without summaries');
      return { plan, err };
    } finally {
      done++;
      progress();
    }
  })));

  const ok = results.filter((x): x is { plan: CallPlan; r: CallResult } => 'r' in x);
  const failed = results.filter((x): x is { plan: CallPlan; err: AllTiersFailedError } => 'err' in x);
  if (!ok.length) throw failed[0].err;

  const placements: CoverageOutcome['placements'] = new Map(ok.flatMap(x => [...x.r.placements]));
  const failedItems = failed.flatMap(f => f.plan.items);
  for (const it of failedItems) placements.set(it.id!, 'forced');
  if (failedItems.length) recordItems(ctx, failedItems, placements);

  const answers = results.map((x, i) => {
    const answer = 'r' in x ? x.r.digest : plainSections(x.plan);
    return keepUpdates[i] ? answer : stripSections(answer, /story updates/i);
  });
  let digest = stitch(answers, ctx.config.format.sectionOrder);
  if (failed.length) digest = `${failureNote(failed.flatMap(f => f.plan.topics), failed[0].err.message)}\n\n${digest}`;

  const first = ok[0].r.llm;
  ctx.stats.llm = {
    ...first,
    truncated: ok.some(x => x.r.llm.truncated),
    attempts: results.flatMap(x => ('r' in x ? x.r.llm.attempts : x.err.attempts)),
    calls: total,
    failedTopics: failed.flatMap(f => f.plan.topics),
  };
  const covs = ok.map(x => x.r.coverage).filter((c): c is CoverageStats => !!c);
  const sum = (k: 'expected' | 'firstPassMissing' | 'unknownIdsInOutput' | 'forced' | 'finalAccounted') => covs.reduce((n, c) => n + c[k], 0);
  ctx.stats.coverage = {
    calls: total,
    expected: sum('expected') + failedItems.length,
    firstPassMissing: sum('firstPassMissing'),
    unknownIdsInOutput: sum('unknownIdsInOutput'),
    rounds: covs.flatMap(c => c.rounds),
    forced: sum('forced') + failedItems.length,
    finalAccounted: sum('finalAccounted') + failedItems.length,
  };
  return { digest, placements, tier: first.tier };
}
