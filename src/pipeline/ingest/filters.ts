// Ports of n8n "Time Window Filter", "Dedup + Sort", "Same-Story Clustering", "Topic Toggles".
// Logic is unchanged unless a comment says otherwise.
import type { Config } from '../../config/schema.js';
import type { Item } from '../types.js';

export const LOOKBACK_HOURS_MAP: Record<string, number> = { '12h': 12, '24h': 24, '3d': 72, '1w': 168, '2w': 336, '1mo': 720 };

const ts = (v: string | null | undefined | 0) => Date.parse((v || 0) as unknown as string);

/** Keeps items newer than the window. Unparseable dates are kept. If everything is filtered,
 *  passes the newest 20 as a fallback (n8n behavior). */
export function timeWindow(items: Item[], lookbackWindow: string, nowMs = Date.now()) {
  const hours = LOOKBACK_HOURS_MAP[lookbackWindow] || 12;
  const cutoff = nowMs - hours * 3600 * 1000;
  const kept: Item[] = [];
  let dropped = 0;
  for (const i of items) {
    const t = Date.parse(i.published as string);
    if (isNaN(t) || t >= cutoff) kept.push(i); else dropped++;
  }
  if (kept.length === 0 && items.length > 0) {
    const fallback = [...items].sort((a, b) => ts(b.published) - ts(a.published)).slice(0, 20);
    return { items: fallback, dropped: items.length - fallback.length, usedFallback: true, hours };
  }
  return { items: kept, dropped, usedFallback: false, hours };
}

/** Dedupe by lowercased link (falling back to title), then newest first. */
export function dedupeAndSort(items: Item[]): { items: Item[]; duplicates: number } {
  const seen = new Set<string>();
  const out = items
    .filter(i => {
      const k = (i.link || i.title || '').toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => ts(b.published) - ts(a.published));
  return { items: out, duplicates: items.length - out.length };
}

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','has','have','had','will','would',
  'could','should','may','might','its','it','this','that','these','those',
  'from','by','as','up','how','what','who','when','where','why','new',
  'says','said','after','over','about','into','than','more','also','just',
]);

const keywordsFrom = (title: string) => title
  .toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/)
  .filter(w => w.length > 3 && !STOP_WORDS.has(w));

export const titleOverlap = (a: string, b: string) => {
  const setA = new Set(keywordsFrom(a));
  const setB = new Set(keywordsFrom(b));
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  const smaller = Math.min(setA.size, setB.size);
  return smaller > 0 ? shared / smaller : 0;
};

/** Groups same-category items whose titles overlap ≥ 0.5 (greedy, first item is primary). */
export function clusterSameStory(items: Item[], threshold = 0.5): { items: Item[]; merged: number } {
  const used = new Set<number>();
  const clusters: number[][] = [];
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const cluster = [i];
    used.add(i);
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      if (items[i].category !== items[j].category) continue; // only cluster within same category
      if (titleOverlap(items[i].title, items[j].title) >= threshold) { cluster.push(j); used.add(j); }
    }
    clusters.push(cluster);
  }
  const out = clusters.map(group => {
    if (group.length === 1) return items[group[0]];
    const primary = items[group[0]];
    return {
      ...primary,
      source: group.map(idx => items[idx].source).join(', '),
      clusterSize: group.length,
      clusterLinks: group.map(idx => items[idx].link).filter(Boolean),
      summary: primary.summary,
    };
  });
  return { items: out, merged: items.length - out.length };
}

/** Drops items whose category is toggled off. Empty toggles = pass-through. */
export function topicFilter(items: Item[], config: Config): { items: Item[]; dropped: number } {
  const toggles = config.topics || {};
  const out = Object.keys(toggles).length === 0
    ? items
    : items.filter(item => !item.category || toggles[item.category] !== false);
  return { items: out, dropped: items.length - out.length };
}

// ── Promotional filter (new; not in n8n) ─────────────────────────────────────
// Studio/publisher marketing for things that are already out: movie/TV clips, featurettes, launch and
// accolades trailers, "now playing" spots, promo codes. Announcement / reveal / first-look trailers are
// kept: those are news. Matched on the title only.
const PROMO_PATTERNS: RegExp[] = [
  /\b(official|exclusive|movie|film|series|tv|extended|bonus|deleted|opening|final|first)\s+(clip|scene)s?\b/i,
  /[|:–—-]\s*clip\b/i,                                    // "… | Clip", "… - Clip 2"
  /\bclip\s*#?\d+\b/i,
  /\bfeaturette\b/i,
  /\bbehind[- ]the[- ]scenes\b/i,
  /\bsneak peek\b/i,
  /\btv spots?\b/i,
  /\b(accolades|launch|commendations|out now|available now|now available)\s+trailer\b/i,
  /\bnow (playing|streaming)\b/i,                          // ad copy; "now available on Mac via…" is news
  /\b(in theaters now|now in theaters)\b/i,
  /\b(promo|coupon|discount) codes?\b/i,
];

export const isPromotionalTitle = (title: string) => PROMO_PATTERNS.some(re => re.test(title));
export const isShort = (link: string, title: string) => link.includes('/shorts/') || /#shorts\b/i.test(title);

/** Drops YouTube Shorts and/or promotional items per config.filters. Runs on raw articles, before the per-source cap. */
export function contentFilter<T extends { title?: string; link?: string; guid?: string; url?: string }>(articles: T[], config: Config) {
  const { shorts, promotional } = config.filters;
  let droppedShorts = 0;
  let droppedPromo = 0;
  const kept = articles.filter(a => {
    const title = a.title || '';
    if (shorts && isShort(a.link || a.guid || a.url || '', title)) { droppedShorts++; return false; }
    if (promotional && isPromotionalTitle(title)) { droppedPromo++; return false; }
    return true;
  });
  return { articles: kept, droppedShorts, droppedPromo };
}
