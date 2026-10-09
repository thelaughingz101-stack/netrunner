import { FEEDS } from './feeds.generated.js';
import { EXTRA_FEEDS, FEED_OVERRIDES } from './feeds.extra.js';
import { SOURCE_MAP as GEN_SOURCE_MAP, YOUTUBE_AUTHORS as GEN_YT, XCANCEL_USERS, PER_SOURCE_CAP } from './sourceMap.generated.js';
import { EXTRA_SOURCE_MAP, EXTRA_YOUTUBE_AUTHORS } from './sourceMap.extra.js';
import type { FeedDef, FeedKind, SourceTag } from './types.js';

export type { FeedDef, FeedKind, SourceTag };
export { XCANCEL_USERS, PER_SOURCE_CAP };

const patched = FEEDS.flatMap(f => {
  if (!(f.name in FEED_OVERRIDES)) return [f];
  const o = FEED_OVERRIDES[f.name];
  return o === null ? [] : [{ ...f, ...o }];
});
export const BUILTIN_FEEDS: FeedDef[] = [...patched, ...EXTRA_FEEDS];
export const SOURCE_MAP: Record<string, SourceTag> = { ...GEN_SOURCE_MAP, ...EXTRA_SOURCE_MAP };
export const YOUTUBE_AUTHORS: Record<string, SourceTag> = { ...GEN_YT, ...EXTRA_YOUTUBE_AUTHORS };

/** The key `config.sources` toggles on — same rule as n8n's Feed List: sourceKey || name. */
export const toggleKey = (f: Pick<FeedDef, 'name' | 'sourceKey'>) => f.sourceKey || f.name;

export function feedKind(url: string): FeedKind {
  if (/youtube\.com\/feeds\//i.test(url)) return 'YouTube';
  if (/xcancel\.com\//i.test(url)) return 'xCancel';
  return 'RSS';
}

/**
 * Topic list shown in the Config UI, in UI order. Every category that has built-in feeds,
 * plus the prompt-only sections the LLM fills from search (Blindspot Analysis), plus Custom Feeds.
 * World News / Business & Finance / Blindspot Analysis were already handled by the pipeline but
 * missing from the n8n-era UI, so they couldn't be switched off (see CHANGES_FROM_N8N.md).
 */
export const TOPICS: string[] = [
  'Gaming', 'TV & Movies', 'Media Announcements', 'Anime', 'Animation',
  'Tech & Hardware', 'AI & LLMs', 'US Politics', 'World News', 'Business & Finance',
  'Science & Space', 'Security', 'Comics', 'Notable Trends', 'Blindspot Analysis',
  'Leaks & Rumors', 'Custom Feeds',
];

export interface UiCatalog {
  topics: string[];
  /** category → kind → toggle keys (the shape netrunner-config.html's SOURCES object had) */
  sources: Record<string, Partial<Record<FeedKind, string[]>>>;
  feedCount: number;
}

export function uiCatalog(): UiCatalog {
  const sources: UiCatalog['sources'] = {};
  for (const topic of TOPICS) {
    const byKind: Partial<Record<FeedKind, string[]>> = {};
    for (const f of BUILTIN_FEEDS.filter(x => x.category === topic)) {
      const kind = feedKind(f.url);
      const list = (byKind[kind] ??= []);
      const key = toggleKey(f);
      if (!list.includes(key)) list.push(key);
    }
    if (Object.keys(byKind).length) sources[topic] = byKind;
  }
  return { topics: TOPICS, sources, feedCount: BUILTIN_FEEDS.length };
}

/** Every distinct toggle key across the catalog. */
export const allToggleKeys = (): string[] => [...new Set(BUILTIN_FEEDS.map(toggleKey))];
