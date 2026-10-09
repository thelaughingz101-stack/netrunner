// Port of n8n "Normalize & Tag" — logic unchanged (the maps live in src/catalog).
import { PER_SOURCE_CAP, SOURCE_MAP, XCANCEL_USERS, YOUTUBE_AUTHORS, type SourceTag } from '../../catalog/index.js';
import type { Item, RawArticle } from '../types.js';

const strip = (s?: string) => (s || '').replace(/<[^>]*>/g, '').trim().slice(0, 400);
const domainOf = (url: string) => {
  const m = (url || '').match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].replace(/^www\./, '') : '';
};
const usernameFromXCancel = (url: string) => {
  const m = (url || '').match(/^https?:\/\/(?:rss\.)?xcancel\.com\/([^/?#]+)/i);
  return m ? m[1].toLowerCase() : '';
};
// Sort keys by length so more specific paths (like reddit.com/r/games) match before reddit.com
const sortedKeys = () => Object.keys(SOURCE_MAP).sort((a, b) => b.length - a.length);

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
  if (host === 'xcancel.com' || host === 'rss.xcancel.com') {
    const username = usernameFromXCancel(link);
    src = username && XCANCEL_USERS[username]
      ? XCANCEL_USERS[username]
      : { name: username ? `@${username}` : 'xCancel', category: 'Custom Feeds' };
  } else if (host === 'www.youtube.com' || host === 'youtube.com') {
    const author = a.author || a['dc:creator'] || a.creator || '';
    src = YOUTUBE_AUTHORS[author] || { name: author || 'YouTube', category: 'Custom Feeds' };
  } else {
    // Path keys match case-insensitively: Reddit links use the subreddit's own casing (/r/Games/,
    // /r/GamingLeaksAndRumours/), so n8n's case-sensitive match tagged every Reddit post as plain "Reddit".
    const lower = link.toLowerCase();
    const key = sortedKeys().find(k => (k.includes('/') && lower.includes(k)) || host === k || host.endsWith('.' + k));
    src = key ? SOURCE_MAP[key] : { name: host || 'Other', category: 'Custom Feeds' };
  }
  return { link, src };
}

export function normalize(articles: RawArticle[], mode: string): { items: Item[]; capped: number } {
  const counts: Record<string, number> = {};
  const out: Item[] = [];
  let capped = 0;
  for (const a of articles) {
    const { link, src } = tagSource(a);

    // Per-source cap only applies to built-in, recognized sources. Custom Feeds (unrecognized
    // YouTube channels, xcancel handles, or RSS domains) are hand-picked and never share a quota.
    if (src.category !== 'Custom Feeds') {
      counts[src.name] = (counts[src.name] || 0) + 1;
      if (counts[src.name] > PER_SOURCE_CAP) { capped++; continue; }
    }

    let title = a.title || '';
    if (link.includes('/shorts/')) title = title + ' [SHORT]';
    out.push({
      mode,
      source: src.name,
      category: src.category,
      title,
      link,
      published: a.isoDate || a.pubDate || a.published || null,
      summary: strip(a.contentSnippet || a.content || a.summary || a.description || ''),
    });
  }
  return { items: out, capped };
}
