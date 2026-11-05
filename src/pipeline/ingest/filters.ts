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

/**
 * An agency's own item leads a story the press also covered (its link, title and summary; named first), so
 * the AI cites what the FDA said rather than a write-up of it. Otherwise the order is kept (newest first).
 */
const officialFirst = (group: Item[]) => [...group.filter(g => g.official), ...group.filter(g => !g.official)];

const site = (url: string) => url.match(/^https?:\/\/(?:www\.)?([^/?#]+)/i)?.[1]?.toLowerCase() ?? '';
/**
 * Two pages on one site from the same source are two stories: an outlet doesn't cover a story twice in one feed
 * (exact repeats are already gone). Short look-alike titles merged otherwise: Zion's game feed had "Until Dawn
 * PC Port" and "Crystal Defenders PC Port" as one story, and 31 of them shrank to 22 (2026-10-26). An outlet's
 * article and its own YouTube video of the same story (two sites) still merge, and so do Reddit posts (different people posting the same news).
 */
const samePublisherPages = (a: Item, b: Item) => a.source === b.source && !!a.link && site(a.link) === site(b.link) && site(a.link) !== 'reddit.com';

/** Groups same-category items whose titles overlap ≥ 0.5 (greedy; the first item, or an official one, is primary). */
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
      if (samePublisherPages(items[i], items[j])) continue;
      if (titleOverlap(items[i].title, items[j].title) >= threshold) { cluster.push(j); used.add(j); }
    }
    clusters.push(cluster);
  }
  const out = clusters.map(ids => {
    if (ids.length === 1) return items[ids[0]];
    const group = officialFirst(ids.map(idx => items[idx]));
    const primary = group[0];
    return {
      ...primary,
      source: group.map(g => g.source).join(', '),
      clusterSize: group.length,
      clusterLinks: group.map(g => g.link).filter(Boolean),
      summary: primary.summary,
    };
  });
  return { items: out, merged: items.length - out.length };
}

// ── Cross-category merging (new; not in n8n) ────────────────────────────────────
// clusterSameStory never looks across categories, so one story tagged differently by two outlets
// (AP → US Politics, NPR → World News) reached the LLM twice and showed up in two sections.
// Stricter than the same-category rule, tuned on real digests: ≥ 3 shared keywords covering
// ≥ 55% of the shorter headline and ≥ 30% of the longer one ("Hi there" or two different
// Forza Horizon 6 stories don't merge; the Nobel Peace Prize from AP and NPR does).
const CROSS_MIN_SHARED = 3;
const CROSS_MIN_SMALLER = 0.55;
const CROSS_MIN_LARGER = 0.3;

function sameStoryKeywords(setA: Set<string>, setB: Set<string>): boolean {
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  const smaller = Math.min(setA.size, setB.size);
  const larger = Math.max(setA.size, setB.size);
  return shared >= CROSS_MIN_SHARED && shared / smaller >= CROSS_MIN_SMALLER && shared / larger >= CROSS_MIN_LARGER;
}

/** Same story across categories? (Same-category pairs are clusterSameStory's job.) */
export const sameStoryAcross = (a: string, b: string) => sameStoryKeywords(new Set(keywordsFrom(a)), new Set(keywordsFrom(b)));

// Sections a merged story only goes to when nothing better covered it: Custom Feeds is the fallback for
// untagged sources, Leaks & Rumors would file a confirmed story as a rumor, Notable Trends is a catch-all.
const WEAK_SECTIONS = ['Custom Feeds', 'Leaks & Rumors', 'Notable Trends'];
const bestSection = (group: Item[]) =>
  [...group].sort((a, b) => weakness(a.category) - weakness(b.category))[0].category;
const weakness = (category: string) => {
  const i = WEAK_SECTIONS.indexOf(category);
  return i < 0 ? -1 : WEAK_SECTIONS.length - i; // real beats first, then Notable Trends, Leaks, Custom Feeds
};

/** Runs after clusterSameStory: merges (clusters of) items from different categories that report the same story. */
export function mergeAcrossCategories(items: Item[]): { items: Item[]; merged: number } {
  const keywords = items.map(it => new Set(keywordsFrom(it.title))); // once per item, not once per pair
  const used = new Set<number>();
  const out: Item[] = [];
  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const found = [items[i]];
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j) || items[j].category === items[i].category) continue;
      if (sameStoryKeywords(keywords[i], keywords[j])) { found.push(items[j]); used.add(j); }
    }
    if (found.length === 1) { out.push(items[i]); continue; }
    const group = officialFirst(found);
    const primary = group[0];
    out.push({
      ...primary,
      category: bestSection(group),
      source: group.map(g => g.source).join(', '),
      clusterSize: group.reduce((n, g) => n + (g.clusterSize ?? 1), 0),
      clusterLinks: group.flatMap(g => g.clusterLinks ?? [g.link]).filter(Boolean),
    });
  }
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

// Pages that aren't stories: the Google News "site:" feeds for official bodies also return a site's search,
// data, shop and login pages. Every one of these reached a digest in 2026-10 (World Bank indicator pages, an
// OECD PISA test question, a CFR store login, Supreme Court search, FDIC BankFind, a SAMHSA dashboard).
const NOT_A_STORY_URL = [
  /\/search(?:\.aspx)?(?:[?/#]|$)/i, /\/(?:cart|checkout|login|signin|sign-in)\b/i, /customer_authentication/i,
  /\.(?:csv|xlsx?|zip|json)(?:[?#]|$)/i, /\/wiki\/(?:Category|Special|Wikipedia|Portal|Template):/i,
  /data\.worldbank\.org\/indicator\//i, /\/datamapper\//i, /bankfind/i, /grants-dashboard/i, /GetStateContactReport/i,
  /pisa\d*-questions\.oecd\.org/i, /\/home\/main\/home/i,
];
// A title that is only the site's name ("- SAMHSA (.gov)", "Search - Supreme Court…", "All Actions - Congress.gov").
const NOT_A_STORY_TITLE = /^\s*(?:[-–|]|(?:Search|All Actions|Home)\s+[-–|]|Category:)/i;

export const isNotAStory = (link: string, title: string) => NOT_A_STORY_TITLE.test(title) || NOT_A_STORY_URL.some(re => re.test(link));

/** Drops YouTube Shorts and/or promotional items per config.filters. Runs on raw articles, before the per-source cap. */
export function contentFilter<T extends { title?: string; link?: string; guid?: string; url?: string }>(articles: T[], config: Config) {
  const { shorts, promotional } = config.filters;
  let droppedShorts = 0;
  let droppedPromo = 0;
  let droppedPages = 0;
  // The user's own feeds are theirs to judge (fmhy.net's "How-to Search FMHY" lives at /posts/search).
  const cs = config.customSources;
  const own = new Set(['Custom RSS', 'Custom YouTube', ...(cs?.youtube ?? []).map(e => (typeof e === 'object' ? e?.handle : null)).filter(Boolean) as string[],
    ...(cs?.bluesky ?? []).map(b => `@${b.handle}`)]);
  const kept = articles.filter(a => {
    const title = a.title || '';
    if (!own.has((a as { _feed?: string })._feed ?? '') && isNotAStory(a.link || a.guid || a.url || '', title)) { droppedPages++; return false; }
    if (shorts && isShort(a.link || a.guid || a.url || '', title)) { droppedShorts++; return false; }
    if (promotional && isPromotionalTitle(title)) { droppedPromo++; return false; }
    return true;
  });
  return { articles: kept, droppedShorts, droppedPromo, droppedPages };
}
