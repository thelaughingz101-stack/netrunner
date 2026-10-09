import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../../env.js';
import { db } from '../../db/db.js';
import type { FeedResult, Item, RunContext } from '../types.js';
import { buildFeedList } from './feedList.js';
import { deadFeedReport, fetchFeeds, type FetchText } from './fetchFeeds.js';
import { normalize } from './normalize.js';
import { clusterSameStory, contentFilter, dedupeAndSort, timeWindow, topicFilter } from './filters.js';

export interface IngestResult {
  items: Item[];
  feedResults: FeedResult[];
}

/** Feed List → RSS Read → Shorts/Promo filter → Normalize & Tag → Time Window → Dedup + Sort → Clustering → Topic Toggles. */
export async function ingest(ctx: RunContext, opts: { fetchText?: FetchText; tries?: number } = {}): Promise<IngestResult> {
  const { config, log } = ctx;
  const { feeds, skippedXCancel } = buildFeedList(config);
  log.info({ feeds: feeds.length, skippedXCancel, custom: feeds.filter(f => f.custom).length }, 'fetching feeds');

  const { articles, results } = await fetchFeeds(feeds, log, { fetchText: opts.fetchText, tries: opts.tries });
  const failed = results.filter(r => r.status === 'error');
  const empty = results.filter(r => r.status === 'empty');

  const cf = contentFilter(articles, config);
  const norm = normalize(cf.articles, ctx.mode);
  const win = timeWindow(norm.items, ctx.lookbackWindow, ctx.now.getTime());
  const dd = dedupeAndSort(win.items);
  const cl = clusterSameStory(dd.items);
  const tf = topicFilter(cl.items, config);

  const stats = {
    feedsAttempted: feeds.length,
    feedsOk: results.filter(r => r.status === 'ok').length,
    feedsEmpty: empty.length,
    feedsFailed: failed.length,
    xcancelSkipped: skippedXCancel,
    articlesFetched: articles.length,
    droppedShorts: cf.droppedShorts,
    droppedPromotional: cf.droppedPromo,
    droppedPerSourceCap: norm.capped,
    droppedOutsideWindow: win.dropped,
    windowFallbackUsed: win.usedFallback,
    droppedDuplicates: dd.duplicates,
    mergedIntoClusters: cl.merged,
    droppedTopicOff: tf.dropped,
    itemsKept: tf.items.length,
  };
  ctx.stats.ingest = stats;
  log.info(stats, 'ingestion complete');
  if (failed.length) log.warn({ dead: failed.map(f => ({ feed: f.feed, code: f.code })) }, `${failed.length} dead feeds`);

  recordFeedResults(ctx, results);
  return { items: tf.items, feedResults: results };
}

function recordFeedResults(ctx: RunContext, results: FeedResult[]) {
  const ins = db().prepare('INSERT INTO feed_results (run_id, feed_name, url, status, item_count, error) VALUES (?, ?, ?, ?, ?, ?)');
  db().transaction(() => {
    for (const r of results) ins.run(ctx.runId, r.feed, r.url, r.status, r.itemCount, r.error ?? (r.code ? String(r.code) : null));
  })();
  const report = deadFeedReport(results);
  if (report && !ctx.dryRun) {
    // n8n wrote dead-feeds-YYYY-MM-DD.txt (UTF-8 BOM) on every run that had failures.
    const dir = path.join(dataDir(), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `dead-feeds-${ctx.today}.txt`), '﻿' + report, 'utf8');
  }
}
