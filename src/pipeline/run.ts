// The pipeline, start to finish. Replaces the n8n canvas wiring:
// trigger → config → Set Mode → ingest → [Autopilot] ids → Build LLM Payload → LLM chain →
// coverage diff/re-run → save → story tracker → delivery gates  |  [Manual] exporter → save.
import { getConfig } from '../config/store.js';
import { db } from '../db/db.js';
import { findDigest, saveDigest } from '../digests.js';
import { log as rootLog } from '../logger.js';
import { developingStories, headlinesFromRun, updateTracker } from '../stories/tracker.js';
import { assignIds, forDelivery, ID_RULE, stripTags, withIdRule } from './coverage/coverage.js';
import { ensureCoverage } from './coverage/index.js';
import { deliverAll, type DeliveryResult } from './delivery/registry.js';
import type { DeliveryTarget } from './delivery/types.js';
import { ingest } from './ingest/index.js';
import type { FetchText } from './ingest/fetchFeeds.js';
import { AllTiersFailedError, generate, type EngineOptions } from './llm/engine.js';
import { resolveMode, type ModeRequest } from './mode.js';
import { buildLlmPayload, buildManualPrompt, type ManualOutput } from './prompt/index.js';
import { monthlyPrompt, weeklyPrompt } from './rollups.js';
import { createRun, finishRun, recordSkipped, type Trigger } from './runs.js';
import type { Mode, RunContext } from './types.js';

export class RunInProgressError extends Error {
  statusCode = 409;
  constructor() { super('a run is already in progress'); }
}

// The lock lives in SQLite so the app and Task Scheduler's headless CLI runs exclude each other.
// A holder whose process is gone (crash, killed window) or that is older than LOCK_STALE_MS is ignored.
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;

const pidAlive = (pid: number) => {
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

type LockRow = { label: string; pid: number; started_at: string };

function liveLock(): LockRow | null {
  const row = db().prepare('SELECT label, pid, started_at FROM run_lock WHERE id = 1').get() as LockRow | undefined;
  if (!row) return null;
  const stale = Date.now() - Date.parse(row.started_at) > LOCK_STALE_MS || !pidAlive(row.pid);
  return stale ? null : row;
}

export const currentRun = () => liveLock()?.label ?? null;

const acquire = (label: string) => db().transaction(() => {
  if (liveLock()) return false;
  db().prepare('INSERT OR REPLACE INTO run_lock (id, label, pid, started_at) VALUES (1, ?, ?, ?)')
    .run(label, process.pid, new Date().toISOString());
  return true;
}).immediate();

async function exclusive<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!acquire(label)) throw new RunInProgressError();
  try { return await fn(); } finally { db().prepare('DELETE FROM run_lock WHERE id = 1 AND pid = ?').run(process.pid); }
}

export interface RunOptions extends ModeRequest {
  trigger: Trigger;
  dryRun?: boolean;
  /** Test seams */
  engine?: EngineOptions;
  fetchText?: FetchText;
  feedTries?: number;
  targets?: DeliveryTarget[];
  now?: Date;
}

export interface DigestRunResult {
  runId: string;
  mode: string;
  date: string;
  digest: string;
  digestId: number;
  llmTier: string;
  delivery: DeliveryResult[];
  stats: Record<string, unknown>;
}

export type RunOutcome =
  | ({ kind: 'digest' } & DigestRunResult)
  | ({ kind: 'prompt'; runId: string; digestId: number } & ManualOutput)
  | { kind: 'skipped'; reason: string };

/** Entry point for every trigger (schedule, Run now, CLI). Honors llm.mode (Autopilot vs Manual). */
export function run(opts: RunOptions): Promise<RunOutcome> {
  return exclusive(`${opts.trigger}:${opts.forceMode ?? 'auto'}`, async () => {
    const { config } = getConfig();
    const decision = resolveMode(config, opts, opts.now);
    if (decision.skip) {
      recordSkipped(opts.trigger, 'rollup', decision.reason);
      rootLog.info({ trigger: opts.trigger, reason: decision.reason }, 'run skipped');
      return { kind: 'skipped', reason: decision.reason };
    }
    if (decision.mode === 'weekly' || decision.mode === 'monthly') {
      return { kind: 'digest', ...(await rollupRun(decision.mode, decision.lookbackWindow, opts)) };
    }
    if (config.llm.mode === 'chatbot') {
      return { kind: 'prompt', ...(await promptRun(decision.mode, decision.lookbackWindow, opts)) };
    }
    return { kind: 'digest', ...(await digestRun(decision.mode, decision.lookbackWindow, opts)) };
  });
}

/** Manual mode ("Generate Prompt"), regardless of llm.mode. */
export function runPrompt(opts: RunOptions) {
  return exclusive(`${opts.trigger}:prompt`, async () => {
    const { config } = getConfig();
    const decision = resolveMode(config, { lookbackWindow: opts.lookbackWindow, forceMode: opts.forceMode === 'morning' || opts.forceMode === 'nightly' ? opts.forceMode : undefined }, opts.now);
    if (decision.skip) throw new Error(decision.reason);
    return promptRun(decision.mode, decision.lookbackWindow, opts);
  });
}

async function guarded<T>(ctx: RunContext, fn: () => Promise<T & { llmTier?: string }>): Promise<T> {
  const t0 = Date.now();
  try {
    const out = await fn();
    ctx.stats.durationMs = Date.now() - t0;
    finishRun(ctx, 'ok', { llmTier: out.llmTier ?? null });
    ctx.log.info({ durationMs: ctx.stats.durationMs }, 'run finished');
    return out;
  } catch (err) {
    ctx.stats.durationMs = Date.now() - t0;
    if (err instanceof AllTiersFailedError) ctx.stats.llmAttempts = err.attempts;
    finishRun(ctx, 'error', { error: (err as Error).message });
    ctx.log.error({ err: (err as Error).message }, 'run failed');
    throw err;
  }
}

async function digestRun(mode: Mode, lookbackWindow: string, opts: RunOptions): Promise<DigestRunResult> {
  const { config } = getConfig();
  const ctx = createRun({ config, mode, lookbackWindow, dryRun: !!opts.dryRun, trigger: opts.trigger, kind: 'digest', now: opts.now });
  return guarded(ctx, async () => {
    ctx.log.info({ trigger: opts.trigger, lookbackWindow }, 'digest run started');
    const { items: raw } = await ingest(ctx, { fetchText: opts.fetchText, tries: opts.feedTries });
    const items = assignIds(raw);

    // Nightly continuity: today's morning digest from the DB (n8n's file lookup had broken).
    const morningDigest = mode === 'nightly' ? (findDigest(ctx.today, 'morning')?.content ?? '') : '';
    const developing = mode === 'nightly' ? developingStories(ctx.today) : [];
    ctx.stats.continuity = { morningDigestFound: !!morningDigest, developingStories: developing.length };

    const prompt = withIdRule(buildLlmPayload({ mode, items, morningDigest }, config, developing));
    const first = await generate({ kind: 'digest', prompt, idRule: ID_RULE }, config, ctx.log, opts.engine);
    ctx.stats.llm = { tier: first.tier, model: first.model, finishReason: first.finishReason, truncated: first.truncated, attempts: first.attempts };

    const coverage = items.length
      ? await ensureCoverage(ctx, items, prompt, first, opts.engine)
      : { digest: first.text, placements: new Map(), forced: 0, rounds: [], extraTiers: [] };
    const digest = stripTags(coverage.digest);

    const digestId = saveDigest({ runId: ctx.runId, date: ctx.today, mode, content: digest, dryRun: ctx.dryRun });
    if (!ctx.dryRun) {
      ctx.stats.stories = updateTracker(headlinesFromRun(items, coverage.placements, coverage.digest), ctx.today);
    }
    // The saved digest keeps every section; deliveries drop EXCLUDED / Everything Else when Format hides them.
    const delivered = forDelivery(digest, config.format);
    const delivery = await deliverAll({ digest: delivered, mode, lookbackWindow }, ctx, opts.targets);
    return { runId: ctx.runId, mode, date: ctx.today, digest, digestId, llmTier: first.tier, delivery, stats: ctx.stats };
  });
}

async function promptRun(mode: Mode, lookbackWindow: string, opts: RunOptions) {
  const { config } = getConfig();
  const ctx = createRun({ config, mode, lookbackWindow, dryRun: !!opts.dryRun, trigger: opts.trigger, kind: 'prompt', now: opts.now });
  return guarded(ctx, async () => {
    const { items } = await ingest(ctx, { fetchText: opts.fetchText, tries: opts.feedTries });
    const morningDigest = mode === 'nightly' ? (findDigest(ctx.today, 'morning')?.content ?? '') : '';
    const out = buildManualPrompt({ mode, items, morningDigest }, config, ctx.today);
    const digestId = saveDigest({
      runId: ctx.runId, date: out.date, mode: out.mode, content: out.digest, dryRun: ctx.dryRun,
      extra: { howToUse: out.howToUse, systemInstructions: out.systemInstructions, userRequest: out.userRequest },
    });
    ctx.stats.prompt = { platform: config.delivery.chatbotPlatform, chars: out.digest.length };
    return { ...out, runId: ctx.runId, digestId };
  });
}

async function rollupRun(mode: 'weekly' | 'monthly', lookbackWindow: string, opts: RunOptions): Promise<DigestRunResult> {
  const { config } = getConfig();
  const ctx = createRun({ config, mode, lookbackWindow, dryRun: !!opts.dryRun, trigger: opts.trigger, kind: 'rollup', now: opts.now });
  return guarded(ctx, async () => {
    const built = (mode === 'weekly' ? weeklyPrompt : monthlyPrompt)(ctx.now, config.schedule.timezone);
    ctx.stats.rollup = { digestsIncluded: built.digestCount, corpus: built.corpusMode };
    const res = await generate({ kind: 'rollup', prompt: built.prompt }, config, ctx.log, opts.engine);
    ctx.stats.llm = { tier: res.tier, model: res.model, finishReason: res.finishReason, truncated: res.truncated, attempts: res.attempts };
    const digestId = saveDigest({ runId: ctx.runId, date: ctx.today, mode, content: res.text, dryRun: ctx.dryRun });
    const delivery = await deliverAll({ digest: res.text, mode, lookbackWindow }, ctx, opts.targets);
    return { runId: ctx.runId, mode, date: ctx.today, digest: res.text, digestId, llmTier: res.tier, delivery, stats: ctx.stats };
  });
}
