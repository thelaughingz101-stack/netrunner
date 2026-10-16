// How much of each source and of each topic goes into a digest, by catch-up range. Both grow with the
// range but slow down: a weekly digest gets more depth, not 14× a 12-hour one (chosen with Zion, 2026-10-16).
import type { Item } from '../types.js';

/** Newest stories kept per built-in source, inside the range (n8n always kept 8, whatever the range). */
export const PER_SOURCE_BY_RANGE: Record<string, number> = { '12h': 8, '24h': 12, '3d': 20, '1w': 30, '2w': 40, '1mo': 50 };
/** Stories kept per topic: the ones the most outlets covered, then the newest. */
export const PER_TOPIC_BY_RANGE: Record<string, number> = { '12h': 25, '24h': 30, '3d': 40, '1w': 55, '2w': 65, '1mo': 80 };

export const perSourceCap = (lookback: string) => PER_SOURCE_BY_RANGE[lookback] ?? PER_SOURCE_BY_RANGE['12h'];
export const perTopicLimit = (lookback: string) => PER_TOPIC_BY_RANGE[lookback] ?? PER_TOPIC_BY_RANGE['12h'];

/** Hand-picked by the user, so never limited. */
const EXEMPT = 'Custom Feeds';

/** Keeps each built-in source's first `cap` items. Give it newest-first items already inside the range. */
export function capPerSource(items: Item[], cap: number): { items: Item[]; capped: number } {
  const counts = new Map<string, number>();
  const out = items.filter(i => {
    if (i.category === EXEMPT) return true;
    const n = (counts.get(i.source) ?? 0) + 1;
    counts.set(i.source, n);
    return n <= cap;
  });
  return { items: out, capped: items.length - out.length };
}

/** Unparseable or missing dates count as oldest. */
const time = (i: Item) => {
  const t = Date.parse(i.published ?? '');
  return Number.isNaN(t) ? -Infinity : t;
};

/** Keeps each topic's `limit` best items (most outlets, then newest), in their original order. */
export function limitPerTopic(items: Item[], limit: number): { items: Item[]; dropped: number } {
  const keep = new Set<Item>();
  const byTopic = new Map<string, Item[]>();
  for (const i of items) {
    if (i.category === EXEMPT) { keep.add(i); continue; }
    if (!byTopic.has(i.category)) byTopic.set(i.category, []);
    byTopic.get(i.category)!.push(i);
  }
  for (const list of byTopic.values()) {
    [...list]
      .sort((a, b) => (b.clusterSize ?? 1) - (a.clusterSize ?? 1) || (time(b) > time(a) ? 1 : time(b) < time(a) ? -1 : 0))
      .slice(0, limit)
      .forEach(i => keep.add(i));
  }
  const out = items.filter(i => keep.has(i));
  return { items: out, dropped: items.length - out.length };
}
