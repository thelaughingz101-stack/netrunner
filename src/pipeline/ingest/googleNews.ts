// Google News search feeds (agencies with no working feed of their own, AP, Reuters…) link every story
// through news.google.com/rss/articles/<id>, so the digest pointed at Google instead of the agency. Google
// gives the real address back for an id: its article page carries a signature and timestamp, and one more
// request trades those for the publisher's URL. Only stories that reach the AI are looked up, each id once
// (gnews_links); anything that fails keeps its Google link.
import pLimit from 'p-limit';
import { db } from '../../db/db.js';
import type { Item } from '../types.js';

const ARTICLE = /^https?:\/\/news\.google\.com\/(?:rss\/)?articles\/([A-Za-z0-9_-]+)/;
export const googleNewsId = (link: string) => link.match(ARTICLE)?.[1] ?? null;

/** id → the publisher's URL, or null when Google wouldn't say. */
export type ResolveId = (id: string) => Promise<string | null>;

const UA = 'Mozilla/5.0 (compatible; NetRunner/1.0; +self-hosted news digest)';
const TIMEOUT_MS = 15_000;
/** At most this many lookups a run (each one downloads a ~0.6 MB Google page). */
const MAX_LOOKUPS = 150;

class RateLimited extends Error {}

/** Asks Google for one article's real URL (the same exchange its own article page makes). */
export const resolveWithGoogle: ResolveId = async id => {
  const page = await fetch(`https://news.google.com/rss/articles/${id}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (page.status === 429) throw new RateLimited();
  if (!page.ok) return null;
  const html = await page.text();
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) return null;
  const req = [[['Fbv4je', `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`]]];
  const res = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': UA },
    body: `f.req=${encodeURIComponent(JSON.stringify(req))}`,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 429) throw new RateLimited();
  if (!res.ok) return null;
  return urlFromBatchResponse(await res.text());
};

/** `)]}'` + [["wrb.fr","Fbv4je","[\"garturlres\",\"https://…\",1]",…],…] → the URL. */
export function urlFromBatchResponse(text: string): string | null {
  try {
    const rows = JSON.parse(text.slice(text.indexOf('[')));
    const row = rows.find((r: unknown[]) => r[0] === 'wrb.fr' && typeof r[2] === 'string');
    const url = row && JSON.parse(row[2])[1];
    return typeof url === 'string' && /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

export interface ResolveStats { lookedUp: number; fromCache: number; resolved: number; failed: number; rateLimited: boolean }

/** Swaps Google News links (item and cluster links) for the publishers' own. */
export async function resolveGoogleNewsLinks(
  items: Item[],
  opts: { resolve?: ResolveId; concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ items: Item[]; stats: ResolveStats }> {
  const resolve = opts.resolve ?? resolveWithGoogle;
  const ids = new Set<string>();
  for (const it of items) for (const l of [it.link, ...(it.clusterLinks ?? [])]) { const id = googleNewsId(l); if (id) ids.add(id); }
  const stats: ResolveStats = { lookedUp: 0, fromCache: 0, resolved: 0, failed: 0, rateLimited: false };
  if (!ids.size) return { items, stats };

  const d = db();
  const known = new Map<string, string>();
  const get = d.prepare('SELECT url FROM gnews_links WHERE id = ?');
  for (const id of ids) { const r = get.get(id) as { url: string } | undefined; if (r) known.set(id, r.url); }
  stats.fromCache = known.size;

  const todo = [...ids].filter(id => !known.has(id)).slice(0, MAX_LOOKUPS);
  const save = d.prepare('INSERT OR REPLACE INTO gnews_links (id, url, resolved_at) VALUES (?, ?, ?)');
  const limit = pLimit(opts.concurrency ?? 3);
  let done = 0;
  opts.onProgress?.(0, todo.length);
  await Promise.all(todo.map(id => limit(async () => {
    if (stats.rateLimited) return;
    stats.lookedUp++;
    try {
      const url = await resolve(id);
      if (url) { known.set(id, url); save.run(id, url, new Date().toISOString()); stats.resolved++; } else stats.failed++;
    } catch (e) {
      stats.failed++;
      if (e instanceof RateLimited) stats.rateLimited = true; // Google said slow down: keep the rest as they are
    } finally {
      opts.onProgress?.(++done, todo.length);
    }
  })));

  const real = (l: string) => { const id = googleNewsId(l); return (id && known.get(id)) || l; };
  const out = items.map(it => {
    const link = real(it.link);
    const clusterLinks = it.clusterLinks?.map(real);
    return link === it.link && !it.clusterLinks?.some((l, i) => l !== clusterLinks![i]) ? it : { ...it, link, ...(clusterLinks ? { clusterLinks } : {}) };
  });
  return { items: out, stats };
}
