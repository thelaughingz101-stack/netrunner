// Feed health (Sources tab): the feeds that are broken or have gone quiet, from the last few runs' fetch
// results. A working feed isn't listed; one bad run isn't either (sites blip), two in a row is.
import { BUILTIN_FEEDS, toggleKey } from '../catalog/index.js';
import type { Config } from '../config/schema.js';
import { db } from '../db/db.js';
import { customFeeds } from './ingest/feedList.js';

export type FeedProblem = 'failing' | 'empty' | 'quiet';

export interface FeedHealthRow {
  feed: string;
  url: string;
  /** The Sources toggle that switches it off (null for your own feeds: remove those under Add your own). */
  toggleKey: string | null;
  topic: string;
  problem: FeedProblem;
  /** Plain words: "not found (404)", "no stories", "last story 23 days ago". */
  detail: string;
  /** When the problem started (first run of the current streak), or the newest story's date for quiet feeds. */
  since: string | null;
}

export interface FeedHealth {
  /** When the newest run checked its feeds; null before the first run. */
  checkedAt: string | null;
  feedsChecked: number;
  problems: FeedHealthRow[];
}

/** Runs looked at. */
const RUNS = 6;
/** In a row before a feed counts as failing or empty. */
const STREAK = 2;
/** No new story for this long = quiet. */
const QUIET_DAYS = 14;

/** A fetch error in plain words. */
export function errorWords(error: string | null): string {
  const e = error ?? '';
  const status = Number(e.match(/\b(\d{3})\b/)?.[1]);
  if (status === 404 || status === 410) return `not found (${status}): the feed moved or was removed`;
  if (status === 401 || status === 403) return `blocked (${status}): the site refuses feed readers`;
  if (status === 429) return 'rate limited (429): the site asked us to slow down';
  if (status >= 500) return `the site had a server error (${status})`;
  if (/timeout|timed out|aborted/i.test(e)) return 'timed out';
  if (/Non-whitespace|Unexpected|Invalid|not recognized|parse/i.test(e)) return "the answer isn't a readable feed";
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|fetch failed/i.test(e)) return "couldn't reach the site";
  return e ? e.slice(0, 120) : 'failed';
}

type Row = { url: string; feed_name: string; status: string; error: string | null; newest_at: string | null; started_at: string };

export function feedHealth(config: Config, now = new Date()): FeedHealth {
  const d = db();
  const runs = d.prepare(`SELECT r.id, r.started_at FROM runs r WHERE EXISTS (SELECT 1 FROM feed_results f WHERE f.run_id = r.id)
    ORDER BY r.started_at DESC LIMIT ?`).all(RUNS) as { id: string; started_at: string }[];
  if (!runs.length) return { checkedAt: null, feedsChecked: 0, problems: [] };
  const rows = d.prepare(`SELECT f.url, f.feed_name, f.status, f.error, f.newest_at, r.started_at FROM feed_results f JOIN runs r ON r.id = f.run_id
    WHERE f.run_id IN (${runs.map(() => '?').join(',')}) ORDER BY r.started_at DESC`).all(...runs.map(r => r.id)) as Row[];

  // Grouped by URL (your own feeds all share the name "Custom RSS"), newest run first.
  const byUrl = new Map<string, Row[]>();
  for (const r of rows) { if (!byUrl.has(r.url)) byUrl.set(r.url, []); byUrl.get(r.url)!.push(r); }
  const latestRun = runs[0].started_at;
  const builtin = new Map(BUILTIN_FEEDS.map(f => [f.url, f]));
  const custom = new Set(customFeeds(config).map(f => f.url));
  // Built-in subreddits are fetched as one combined Reddit feed (feedList.combineReddit).
  const reddit = (url: string) => /reddit\.com\/r\/[^/]+\+/.test(url);
  const topicOn = (t: string) => config.topics[t] !== false;
  const sourceOn = (k: string) => !config.sources || config.sources[k] !== false;

  const problems: FeedHealthRow[] = [];
  let checked = 0;
  for (const [url, history] of byUrl) {
    // Only feeds the newest run fetched and that are still switched on: the rest aren't fetched any more.
    if (history[0].started_at !== latestRun) continue;
    const def = builtin.get(url);
    const key = def ? toggleKey(def) : null;
    const topic = def?.category ?? (reddit(url) ? 'Several topics' : 'Custom Feeds');
    if (def ? !(topicOn(topic) && sourceOn(key!)) : !custom.has(url) && !reddit(url)) continue;
    checked++;
    const streak = (status: string) => { let n = 0; while (n < history.length && history[n].status === status) n++; return n; };
    const base = { feed: history[0].feed_name, url, toggleKey: key, topic };
    const failing = streak('error');
    const empty = streak('empty');
    if (failing >= STREAK) {
      problems.push({ ...base, problem: 'failing', detail: errorWords(history[0].error), since: history[failing - 1].started_at });
    } else if (empty >= STREAK) {
      problems.push({ ...base, problem: 'empty', detail: 'the feed answers but has no stories', since: history[empty - 1].started_at });
    } else {
      const newest = history.map(h => h.newest_at).find(Boolean);
      const days = newest ? Math.floor((now.getTime() - Date.parse(newest)) / 864e5) : 0;
      if (days >= QUIET_DAYS) problems.push({ ...base, problem: 'quiet', detail: `last story ${days} days ago`, since: newest! });
    }
  }
  const order: Record<FeedProblem, number> = { failing: 0, empty: 1, quiet: 2 };
  problems.sort((a, b) => order[a.problem] - order[b.problem] || a.topic.localeCompare(b.topic) || a.feed.localeCompare(b.feed));
  return { checkedAt: latestRun, feedsChecked: checked, problems };
}
