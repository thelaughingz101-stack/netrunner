// Port of n8n "Normalize & Tag" — logic unchanged (the maps live in src/catalog).
import { BUILTIN_FEEDS, SOURCE_MAP, YOUTUBE_AUTHORS, isOfficial, toggleKey, type SourceTag } from '../../catalog/index.js';
import type { Item, RawArticle } from '../types.js';

const strip = (s?: string) => (s || '').replace(/<[^>]*>/g, '').trim().slice(0, 400);
const domainOf = (url: string) => {
  const m = (url || '').match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].replace(/^www\./, '') : '';
};
// Sort keys by length so more specific paths (like reddit.com/r/games) match before reddit.com
const sortedKeys = () => Object.keys(SOURCE_MAP).sort((a, b) => b.length - a.length);
/** Your own Bluesky accounts: named after the account (its feed is called "@handle"), not "bsky.app". */
const blueskyTag = (link: string, feed?: string): SourceTag => ({
  name: feed?.startsWith('@') ? feed : `@${decodeURIComponent(link.match(/bsky\.app\/profile\/([^/]+)/)?.[1] ?? 'bluesky')}`,
  category: 'Custom Feeds',
});
/** A built-in feed's own tag, for items whose link names no known source (UKHSA and UK AISI post on www.gov.uk). */
const builtinTag = new Map(BUILTIN_FEEDS.map(f => [f.name, { name: toggleKey(f), category: f.category }]));

export function tagSource(a: RawArticle): { link: string; src: SourceTag } {
  const link = a.link || a.guid || a.url || '';
  let host = domainOf(link);
  // Google News proxy links all point at news.google.com, which lumped AP, Reuters and Wikipedia under one
  // "Google News" tag sharing one per-source cap. Its <source url="https://apnews.com"> names the publisher.
  if (host === 'news.google.com') {
    const s = a.source?.[0];
    const publisher = s && typeof s === 'object' ? domainOf(s.$?.url || '') : '';
    if (publisher) host = publisher;
  }
  let src: SourceTag;
  if (host === 'www.youtube.com' || host === 'youtube.com') {
    const author = a.author || a['dc:creator'] || a.creator || '';
    src = YOUTUBE_AUTHORS[author] || { name: author || 'YouTube', category: 'Custom Feeds' };
  } else {
    // Path keys match case-insensitively: Reddit links use the subreddit's own casing (/r/Games/,
    // /r/GamingLeaksAndRumours/), so n8n's case-sensitive match tagged every Reddit post as plain "Reddit".
    const lower = link.toLowerCase();
    const key = sortedKeys().find(k => (k.includes('/') && lower.includes(k)) || host === k || host.endsWith('.' + k));
    src = key ? SOURCE_MAP[key] : builtinTag.get(a._feed ?? '') ?? (host === 'bsky.app' ? blueskyTag(link, a._feed) : { name: host || 'Other', category: 'Custom Feeds' });
  }
  return { link, src };
}

/**
 * Posts have no title (Bluesky): the first line of the text without its links and trailing hashtags
 * ("… restocked at PNP ($64.99) buff.ly/rjq1JsX #ad"), cut at a word near 140 characters.
 */
export function titleFromText(text: string): string {
  const line = strip(text).split('\n')
    .map(l => l.replace(/\bhttps?:\/\/\S+/g, '').replace(/\b[\w-]+(\.[\w-]+)+\/\S*/g, '').replace(/(\s+#\w+)+\s*$/, '').replace(/\s{2,}/g, ' ').trim())
    .find(Boolean) ?? '';
  if (line.length <= 140) return line;
  const cut = line.slice(0, 140);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 80 ? cut.lastIndexOf(' ') : 140)}…`;
}

// n8n also capped each source at 8 here, before the time window; the cap now runs after it and grows with the
// catch-up range (limits.ts).
export function normalize(articles: RawArticle[], mode: string): { items: Item[] } {
  const out: Item[] = [];
  for (const a of articles) {
    const { link, src } = tagSource(a);
    let title = a.title || titleFromText(a.contentSnippet || a.content || a.description || '');
    if (link.includes('/shorts/')) title = title + ' [SHORT]';
    out.push({
      mode,
      source: src.name,
      category: src.category,
      title,
      link,
      published: a.isoDate || a.pubDate || a.published || null,
      summary: strip(a.contentSnippet || a.content || a.summary || a.description || ''),
      ...(isOfficial(src.name) ? { official: true as const } : {}),
    });
  }
  return { items: out };
}
