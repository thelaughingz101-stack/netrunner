// Each feed's last answer, kept so the next run can ask the site "changed since?" (ETag / Last-Modified). A 304
// answer costs the site almost nothing and is reused from here; feeds that send neither header aren't kept.
import { db } from '../../db/db.js';

export interface CachedFeed { etag?: string | null; lastModified?: string | null; body: string }

export interface FeedCache {
  get(url: string): CachedFeed | undefined;
  put(url: string, entry: CachedFeed): void;
  /** The cached answer was used again (a 304), so it isn't pruned. */
  touch(url: string): void;
}

/** Entries no run has used for this long are dropped (a feed switched off or removed). */
const KEEP_DAYS = 30;

export function dbFeedCache(): FeedCache {
  const d = db();
  const now = () => new Date().toISOString();
  d.prepare('DELETE FROM feed_cache WHERE used_at < ?').run(new Date(Date.now() - KEEP_DAYS * 864e5).toISOString());
  return {
    get: url => d.prepare('SELECT etag, last_modified AS lastModified, body FROM feed_cache WHERE url = ?').get(url) as CachedFeed | undefined,
    put: (url, e) => {
      d.prepare('INSERT OR REPLACE INTO feed_cache (url, etag, last_modified, body, used_at) VALUES (?, ?, ?, ?, ?)')
        .run(url, e.etag ?? null, e.lastModified ?? null, e.body, now());
    },
    touch: url => { d.prepare('UPDATE feed_cache SET used_at = ? WHERE url = ?').run(now(), url); },
  };
}

/** In memory, for tests. */
export function memoryFeedCache(): FeedCache & { entries: Map<string, CachedFeed> } {
  const entries = new Map<string, CachedFeed>();
  return { entries, get: url => entries.get(url), put: (url, e) => { entries.set(url, e); }, touch: () => {} };
}
