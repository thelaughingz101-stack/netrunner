// "≈ 420 stories · about 9 min" next to Run News Digest: a rough forecast for the settings on screen, from the
// last few runs (which sources brought how many stories, and how long a story took to write).
import { BUILTIN_FEEDS, toggleKey } from '../catalog/index.js';
import type { Config } from '../config/schema.js';
import { db } from '../db/db.js';
import { perSourceCap, perTopicLimit } from './ingest/limits.js';

export interface Estimate {
  stories: number;
  minutes: number;
  /** How many past runs it's based on. */
  runs: number;
}

/** Recent runs the forecast learns from. */
const HISTORY = 10;
/** A source that brought nothing in those runs (new, or quiet) counts as this share of a typical source. */
const UNSEEN_WEIGHT = 0.5;

type RunRow = { id: string; lookback: string | null; stats_json: string | null };

export function estimateRun(config: Config): Estimate | null {
  const d = db();
  const all = d.prepare("SELECT id, lookback, stats_json FROM runs WHERE kind = 'digest' AND status = 'ok' AND dry_run = 0 ORDER BY started_at DESC LIMIT ?")
    .all(HISTORY * 3) as RunRow[];
  const lookback = config.schedule.lookbackWindow;
  const same = all.filter(r => r.lookback === lookback);
  const runs = (same.length ? same : all).slice(0, HISTORY);
  if (!runs.length) return null;

  const size = config.format.digestSize;
  const sourceCap = perSourceCap(lookback, size);
  const topicCap = perTopicLimit(lookback, size);
  const topicOn = (t: string) => config.topics[t] !== false;
  const sourceOn = (k: string) => !config.sources || config.sources[k] !== false;
  // Toggle keys per topic.
  const keysByTopic = new Map<string, Set<string>>();
  for (const f of BUILTIN_FEEDS) {
    if (!keysByTopic.has(f.category)) keysByTopic.set(f.category, new Set());
    keysByTopic.get(f.category)!.add(toggleKey(f));
  }

  const items = d.prepare('SELECT source, category FROM run_items WHERE run_id = ?');
  const perRun: number[] = [];
  const minutesPerStory: number[] = [];
  for (const r of runs) {
    // Stories per source, by topic. A merged story ("FDA, CNBC") counts for its first source.
    const counts = new Map<string, Map<string, number>>();
    for (const it of items.all(r.id) as { source: string | null; category: string | null }[]) {
      const src = (it.source ?? '').split(', ')[0];
      const cat = it.category ?? '';
      if (!counts.has(cat)) counts.set(cat, new Map());
      counts.get(cat)!.set(src, (counts.get(cat)!.get(src) ?? 0) + 1);
    }
    const seen = [...counts.values()].flatMap(m => [...m.values()]);
    if (!seen.length) continue;
    const typical = seen.reduce((a, b) => a + b, 0) / seen.length;

    let total = 0;
    for (const topic of new Set([...keysByTopic.keys(), ...counts.keys()])) {
      if (!topicOn(topic)) continue;
      const got = counts.get(topic) ?? new Map<string, number>();
      if (topic === 'Custom Feeds') { total += [...got.values()].reduce((a, b) => a + b, 0); continue; } // never capped
      let n = 0;
      for (const [src, c] of got) if (sourceOn(src)) n += Math.min(c, sourceCap);
      for (const k of keysByTopic.get(topic) ?? []) if (sourceOn(k) && !got.has(k)) n += Math.min(typical, sourceCap) * UNSEEN_WEIGHT;
      total += Math.min(n, topicCap);
    }
    perRun.push(total);

    const stats = r.stats_json ? JSON.parse(r.stats_json) : null;
    const kept = stats?.ingest?.itemsKept;
    if (stats?.durationMs && kept) minutesPerStory.push(stats.durationMs / 60_000 / kept);
  }
  if (!perRun.length) return null;

  const mid = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const stories = Math.round(mid(perRun));
  const minutes = minutesPerStory.length ? Math.max(1, Math.round(stories * mid(minutesPerStory))) : 0;
  return { stories, minutes, runs: perRun.length };
}
