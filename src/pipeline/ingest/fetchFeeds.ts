// Replaces n8n's "RSS Read" node (retryOnFail, error branch → Filter Errors Code → Dead Feed Alert).
// n8n's RSS Read is built on rss-parser, so items keep the exact field names Normalize & Tag reads.
import Parser from 'rss-parser';
import pLimit from 'p-limit';
import { env } from '../../env.js';
import type { Logger } from '../../logger.js';
import type { FeedResult, RawArticle } from '../types.js';
import type { FeedToFetch } from './feedList.js';

const parser = new Parser({ timeout: 0, customFields: { item: [['dc:creator', 'dc:creator'], ['source', 'source', { keepArray: true }]] } });
const UA = 'Mozilla/5.0 (compatible; NetRunner/1.0; +self-hosted news digest)';

/** retryAfterSec: how long the server asked us to wait (Retry-After, or Reddit's x-ratelimit-reset). */
export type FetchText = (url: string, timeoutMs: number) => Promise<{ status: number; text: string; retryAfterSec?: number }>;

const defaultFetchText: FetchText = async (url, timeoutMs) => {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
  });
  const wait = Number(res.headers.get('retry-after') ?? res.headers.get('x-ratelimit-reset'));
  return { status: res.status, text: await res.text(), ...(Number.isFinite(wait) && wait >= 0 ? { retryAfterSec: wait } : {}) };
};

/** Longest we'll wait on a rate limit before retrying (Reddit's window is 60 s). */
const MAX_RATE_LIMIT_WAIT_S = 65;

class HttpError extends Error {
  constructor(public status: number, public retryAfterSec?: number) { super(`HTTP ${status}`); }
}

export const isTransient = (status: number, url: string) =>
  status >= 500 || status === 429 || status === 419 || (status === 404 && /youtube\.com\/feeds\//.test(url));

async function fetchOne(feed: FeedToFetch, fetchText: FetchText, timeoutMs: number, tries: number): Promise<RawArticle[]> {
  let lastErr: unknown;
  // YouTube's feed endpoint flips between 200 and 404 for the same channel, so it gets extra attempts.
  const maxTries = tries > 1 && /youtube\.com\/feeds\//.test(feed.url) ? Math.max(tries, 5) : tries;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      const { status, text, retryAfterSec } = await fetchText(feed.url, timeoutMs);
      if (status >= 400) throw new HttpError(status, retryAfterSec);
      const parsed = await parser.parseString(text);
      return (parsed.items || []).map(i => ({ ...(i as RawArticle), _feed: feed.name }));
    } catch (e) {
      lastErr = e;
      // Don't retry client errors (404/403/410) — they won't fix themselves in a second. Exceptions:
      // 429 / 419 (Hacker News' "slow down") are rate limits, and YouTube's feed endpoint intermittently
      // 404s channels that exist (Business Insider failed ~1 run in 3 that way).
      if (e instanceof HttpError && !isTransient(e.status, feed.url)) break;
      // A 429 that says how long to wait gets exactly that (Reddit: ~60 s), instead of the short backoff.
      const asked = e instanceof HttpError && e.status === 429 && e.retryAfterSec !== undefined
        ? Math.min(e.retryAfterSec + 1, MAX_RATE_LIMIT_WAIT_S) * 1000 : 0;
      if (attempt < maxTries) await new Promise(r => setTimeout(r, asked || 2000 * attempt));
    }
  }
  throw lastErr;
}

export async function fetchFeeds(
  feeds: FeedToFetch[],
  log: Logger,
  opts: { fetchText?: FetchText; timeoutMs?: number; concurrency?: number; tries?: number } = {},
): Promise<{ articles: RawArticle[]; results: FeedResult[] }> {
  const e = env();
  const limit = pLimit(opts.concurrency ?? e.FEED_CONCURRENCY);
  const fetchText = opts.fetchText ?? defaultFetchText;
  const timeoutMs = opts.timeoutMs ?? e.FEED_TIMEOUT_MS;
  const tries = opts.tries ?? 3;

  // One request at a time per host (Reddit 429s several parallel .rss hits), N in flight overall.
  const hostLimits = new Map<string, ReturnType<typeof pLimit>>();
  const perHost = (url: string) => {
    let host = 'unknown';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep 'unknown' */ }
    if (!hostLimits.has(host)) hostLimits.set(host, pLimit(1));
    return hostLimits.get(host)!;
  };

  const settled = await Promise.all(feeds.map(feed => perHost(feed.url)(() => limit(async () => {
    try {
      const items = await fetchOne(feed, fetchText, timeoutMs, tries);
      return { feed, items, result: { feed: feed.name, url: feed.url, status: items.length ? 'ok' : 'empty', itemCount: items.length } as FeedResult };
    } catch (err) {
      const code = err instanceof HttpError ? err.status : (err as Error).name === 'TimeoutError' ? 'timeout' : 'error';
      log.debug({ feed: feed.name, url: feed.url, code }, 'feed failed');
      return { feed, items: [] as RawArticle[], result: { feed: feed.name, url: feed.url, status: 'error', itemCount: 0, code, error: (err as Error).message } as FeedResult };
    }
  }))));

  return { articles: settled.flatMap(s => s.items), results: settled.map(s => s.result) };
}

/** Same text n8n's "Dead Feed Alert" produced (written to the run log + dead-feeds file). */
export function deadFeedReport(results: FeedResult[]): string | null {
  const bad = results.filter(r => r.status === 'error');
  if (bad.length === 0) return null;
  const list = bad.map(b => `❌ \`${b.url}\` (${b.code ?? 'error'})`).join('\n');
  return `⚠️ **Dead Feeds Detected:**\n${list}`;
}
