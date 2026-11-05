// "Add your own" → RSS feeds: checks a feed before it's saved, the way YouTube channels and Bluesky accounts are
// checked (Zion, 2026-10-26: a typo'd or dead feed was saved silently). Takes a feed address, or a site's
// address and finds the feed the site advertises (<link rel="alternate" type="application/rss+xml">).
import Parser from 'rss-parser';
import { decodeEntities } from '../pipeline/llm/local.js';

export interface FeedInfo {
  /** The feed's own address (a site address becomes the feed it advertises). */
  url: string;
  title: string | null;
  site: string | null;
  icon: string | null;
  items: number;
  newest: string | null;
  newestTitle: string | null;
}
export type FeedResult = FeedInfo | { error: string };

const UA = 'Mozilla/5.0 (compatible; NetRunner/1.0; +self-hosted news digest)';
const parser = new Parser({ timeout: 0 });

/** The feed a web page advertises, as an absolute address. */
export function discoverFeed(html: string, base: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(?:rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) try { return new URL(href.replace(/&amp;/g, '&'), base).href; } catch { /* bad href */ }
  }
  return null;
}

const looksLikeFeed = (text: string) => /<(?:rss|feed|rdf:RDF)\b/i.test(text.slice(0, 2000));

export async function resolveFeed(query: string, fetchImpl: typeof fetch = fetch): Promise<FeedResult> {
  let url = (query || '').trim();
  if (!url) return { error: 'Paste a feed or website address.' };
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try { url = new URL(url).href; } catch { return { error: "That isn't a web address." }; }

  const get = async (u: string) => {
    const res = await fetchImpl(u, { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5' } });
    return { status: res.status, text: await res.text(), url: res.url || u };
  };
  try {
    let page = await get(url);
    if (page.status >= 400) return { error: `The site answered HTTP ${page.status}. Check the address.` };
    if (!looksLikeFeed(page.text)) {
      const found = discoverFeed(page.text, page.url);
      if (!found) return { error: "That page isn't a feed, and it doesn't point to one. Look for an RSS link on the site." };
      url = found;
      page = await get(found);
      if (page.status >= 400 || !looksLikeFeed(page.text)) return { error: `The site points to ${found}, but that isn't a working feed.` };
    }
    const feed = await parser.parseString(page.text);
    const items = feed.items ?? [];
    const dated = items.map(i => ({ t: Date.parse(i.isoDate ?? i.pubDate ?? ''), title: i.title ?? null })).filter(i => !Number.isNaN(i.t)).sort((a, b) => b.t - a.t);
    const site = feed.link ?? null;
    let host: string | null = null;
    try { host = new URL(site ?? url).origin; } catch { /* no site */ }
    return {
      url,
      title: feed.title ? decodeEntities(feed.title).trim() || null : null,
      site,
      icon: (feed.image as { url?: string } | undefined)?.url ?? (host ? `${host}/favicon.ico` : null),
      items: items.length,
      newest: dated[0] ? new Date(dated[0].t).toISOString() : null,
      newestTitle: (t => (t ? decodeEntities(t) : null))(dated[0]?.title ?? items[0]?.title ?? null),
    };
  } catch (e) {
    return { error: /Non-whitespace|Unexpected|Invalid|not a feed/i.test((e as Error).message) ? "That address doesn't return a readable feed." : `Couldn't reach it: ${(e as Error).message}` };
  }
}
