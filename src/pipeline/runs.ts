import crypto from 'node:crypto';
import { db } from '../db/db.js';
import { log as rootLog } from '../logger.js';
import type { Config } from '../config/schema.js';
import { localDate } from './mode.js';
import type { Mode, RunContext } from './types.js';

export type Trigger = 'schedule' | 'manual' | 'api' | 'cli';
export type RunKind = 'digest' | 'prompt' | 'rollup';

export function newRunId(now = new Date()): string {
  return `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}-${crypto.randomBytes(3).toString('hex')}`;
}

export function createRun(args: { config: Config; mode: Mode; lookbackWindow: string; dryRun: boolean; trigger: Trigger; kind: RunKind; now?: Date }): RunContext {
  const now = args.now ?? new Date();
  const runId = newRunId(now);
  db().prepare('INSERT INTO runs (id, trigger, kind, mode, lookback, dry_run, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(runId, args.trigger, args.kind, args.mode, args.lookbackWindow, args.dryRun ? 1 : 0, 'running', now.toISOString());
  return {
    runId,
    config: args.config,
    mode: args.mode,
    lookbackWindow: args.lookbackWindow,
    dryRun: args.dryRun,
    now,
    today: localDate(now, args.config.schedule.timezone),
    log: rootLog.child({ runId, mode: args.mode, dryRun: args.dryRun || undefined }),
    stats: {},
  };
}

export function finishRun(ctx: RunContext, status: 'ok' | 'error', extra: { llmTier?: string | null; error?: string } = {}) {
  db().prepare('UPDATE runs SET status = ?, finished_at = ?, llm_tier = ?, stats_json = ?, error = ? WHERE id = ?')
    .run(status, new Date().toISOString(), extra.llmTier ?? null, JSON.stringify(ctx.stats), extra.error ?? null, ctx.runId);
}

/** Record a run that never started (e.g. rollup disabled) so the log shows why. */
export function recordSkipped(trigger: Trigger, kind: RunKind, reason: string) {
  const now = new Date();
  db().prepare("INSERT INTO runs (id, trigger, kind, status, started_at, finished_at, error) VALUES (?, ?, ?, 'skipped', ?, ?, ?)")
    .run(newRunId(now), trigger, kind, now.toISOString(), now.toISOString(), reason);
}

export function listRuns(limit = 50) {
  return db().prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').all(limit).map((r: any) => ({
    id: r.id, trigger: r.trigger, kind: r.kind, mode: r.mode, lookback: r.lookback, dryRun: !!r.dry_run,
    status: r.status, llmTier: r.llm_tier, startedAt: r.started_at, finishedAt: r.finished_at,
    stats: r.stats_json ? JSON.parse(r.stats_json) : null, error: r.error,
  }));
}

export function getRun(id: string) {
  const run = listRunsById(id);
  if (!run) return null;
  const d = db();
  return {
    ...run,
    feeds: d.prepare('SELECT feed_name AS feed, url, status, item_count AS itemCount, error FROM feed_results WHERE run_id = ?').all(id),
    items: d.prepare('SELECT item_id AS id, source, category, title, link, placement FROM run_items WHERE run_id = ? ORDER BY item_id').all(id),
    deliveries: d.prepare('SELECT target, status, detail, at FROM deliveries WHERE run_id = ? ORDER BY at').all(id),
  };
}

function listRunsById(id: string) {
  const r: any = db().prepare('SELECT * FROM runs WHERE id = ?').get(id);
  if (!r) return null;
  return {
    id: r.id, trigger: r.trigger, kind: r.kind, mode: r.mode, lookback: r.lookback, dryRun: !!r.dry_run,
    status: r.status, llmTier: r.llm_tier, startedAt: r.started_at, finishedAt: r.finished_at,
    stats: r.stats_json ? JSON.parse(r.stats_json) : null, error: r.error,
  };
}
