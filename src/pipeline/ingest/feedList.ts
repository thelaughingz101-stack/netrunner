// Port of n8n "Feed List Code": built-in FEEDS + custom sources from config, filtered by
// the per-source toggles. One deliberate change: xCancel feeds are skipped (globally blocked —
// they only ever returned 1971-dated placeholders). See CHANGES_FROM_N8N.md.
import { BUILTIN_FEEDS, feedKind, toggleKey, type FeedDef } from '../../catalog/index.js';
import type { Config } from '../../config/schema.js';

export interface FeedToFetch extends FeedDef {
  custom?: boolean;
}

export function customFeeds(config: Config): FeedToFetch[] {
  const cs = config.customSources;
  const out: FeedToFetch[] = [];
  (cs.rss || []).forEach(url =>
    out.push({ name: 'Custom RSS', category: 'Custom Feeds', type: 'rss', url, custom: true }));
  (cs.youtube || []).forEach(entry => {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (!id) return;
    const label = (typeof entry === 'object' && entry.handle) ? entry.handle : 'Custom YouTube';
    out.push({ name: label, category: 'Custom Feeds', type: 'rss', custom: true,
      url: `https://www.youtube.com/feeds/videos.xml?channel_id=${id}` });
  });
  (cs.xcancel || []).forEach(handle =>
    out.push({ name: `@${handle}`, category: 'Custom Feeds', type: 'rss', custom: true,
      url: `https://xcancel.com/${handle}/rss` }));
  return out;
}

export function buildFeedList(config: Config, opts: { includeXCancel?: boolean } = {}): { feeds: FeedToFetch[]; skippedXCancel: number } {
  // Source toggles — null/empty means no config yet, treat as all enabled (n8n behavior)
  const enabledSources = config.sources && Object.keys(config.sources).length > 0 ? config.sources : null;
  const all = [...BUILTIN_FEEDS, ...customFeeds(config)].filter(f => f.url);
  const toggled = enabledSources ? all.filter(f => enabledSources[toggleKey(f)] !== false) : all;
  if (opts.includeXCancel) return { feeds: toggled, skippedXCancel: 0 };
  const noX = toggled.filter(f => feedKind(f.url) !== 'xCancel');
  return { feeds: combineReddit(noX), skippedXCancel: toggled.length - noX.length };
}

const SUBREDDIT_RSS = /^https?:\/\/(?:www\.|old\.)?reddit\.com\/r\/([A-Za-z0-9_]+)\/?\.rss$/i;

/**
 * Logged out, Reddit allows about one request per minute, so fetching each subreddit's .rss separately
 * got all but the first one a 429. Reddit serves several subreddits as one feed (/r/a+b+c/.rss, 100 newest
 * "hot" posts across them); each post's link still names its own subreddit, so tagging is unchanged.
 */
export function combineReddit(feeds: FeedToFetch[]): FeedToFetch[] {
  const reddit = feeds.filter(f => SUBREDDIT_RSS.test(f.url));
  if (reddit.length < 2) return feeds;
  const subs = [...new Set(reddit.map(f => f.url.match(SUBREDDIT_RSS)![1].toLowerCase()))];
  const combined: FeedToFetch = {
    name: `Reddit (${subs.map(s => `r/${s}`).join(', ')})`,
    category: reddit[0].category,
    type: 'rss',
    url: `https://www.reddit.com/r/${subs.join('+')}/.rss?limit=100`,
    custom: reddit.every(f => f.custom),
  };
  const firstAt = feeds.indexOf(reddit[0]);
  const rest = feeds.filter(f => !reddit.includes(f));
  rest.splice(firstAt, 0, combined);
  return rest;
}
