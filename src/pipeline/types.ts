import type { Config } from '../config/schema.js';
import type { Logger } from '../logger.js';

export type DigestMode = 'morning' | 'nightly';
export type Mode = DigestMode | 'weekly' | 'monthly';

/** An article as parsed from a feed — the same field names n8n's RSS Read node emitted. */
export interface RawArticle {
  title?: string;
  link?: string;
  guid?: string;
  url?: string;
  author?: string;
  creator?: string;
  'dc:creator'?: string;
  isoDate?: string;
  pubDate?: string;
  published?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
  description?: string;
  /** RSS <source url="…">Publisher</source> — Google News uses it to name the original publisher. */
  source?: Array<string | { _?: string; $?: { url?: string } }>;
  /** Which feed it came from (added by us, for per-feed stats). */
  _feed?: string;
}

/** Output of Normalize & Tag (same shape as the n8n node). */
export interface Item {
  mode: string;
  source: string;
  category: string;
  title: string;
  link: string;
  published: string | null;
  summary: string;
  clusterSize?: number;
  clusterLinks?: string[];
  /** Assigned before the LLM sees the item (omission protection). */
  id?: string;
}

export interface FeedResult {
  feed: string;
  url: string;
  status: 'ok' | 'empty' | 'error';
  itemCount: number;
  error?: string;
  code?: number | string;
}

/** Everything a run needs, threaded through the stages (replaces n8n's $('Node') lookups). */
export interface RunContext {
  runId: string;
  config: Config;
  mode: Mode;
  lookbackWindow: string;
  dryRun: boolean;
  now: Date;
  /** YYYY-MM-DD in config.schedule.timezone */
  today: string;
  log: Logger;
  stats: Record<string, unknown>;
}
