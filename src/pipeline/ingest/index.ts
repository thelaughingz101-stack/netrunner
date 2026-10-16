import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../../env.js';
import { db } from '../../db/db.js';
import type { FeedResult, Item, RunContext } from '../types.js';
import { buildFeedList } from './feedList.js';
import { deadFeedReport, fetchFeeds, type FetchText } from './fetchFeeds.js';
import { normalize } from './normalize.js';
import { clusterSameStory, contentFilter, dedupeAndSort, mergeAcrossCategories, timeWindow, topicFilter } from './filters.js';
import { capPerSource, limitPerTopic, perSourceCap, perTopicLimit } from './limits.js';

export interface IngestResult {
  items: Item[];
  feedResults: FeedResult[];
}

/** Feed List → RSS Read → Shorts/Promo filter → Normalize & Tag → Time Window → Dedup + Sort → Per-source cap → Clustering → Topic Toggles → Cross-category merge → Per-topic limit. */
export async function ingest(ctx: RunContext, opts: { fetchText?: FetchText; tries?: number } = {}): Promise<IngestResult> {
  const { config, log } = ctx;
  const { feeds, skippedXCancel } = buildFeedList(config);
  log.info({ feeds: feeds.length, skippedXCancel, custom: feeds.filter(f => f.custom).length }, 'fetching feeds');

  // At most a few progress writes a second: a run fetches 100+ feeds.
  let shown = 0;
  const fetching = (done: number, total: number) => {
    if (done < total && Date.now() - shown < 250) return;
    shown = Date.now();
    ctx.progress?.(`Fetching sources (${done} of ${total})`);
  };
  fetching(0, feeds.length);
  const { articles, results } = await fetchFeeds(feeds, log, { fetchText: opts.fetchText, tries: opts.tries, onProgress: fetching });
  ctx.progress?.(`Sorting and tagging ${articles.length} stories`);
  const failed = results.filter(r => r.status === 'error');
  const empty = results.filter(r => r.status === 'empty');

  const cf = contentFilter(articles, config);
  const norm = normalize(cf.articles, ctx.mode);
  const win = timeWindow(norm.items, ctx.lookbackWindow, ctx.now.getTime());
  const dd = dedupeAndSort(win.items);
  // After the window and newest-first: each source keeps its newest stories inside the range (n8n capped
  // first, so a source could fill its 8 with stories the window then threw away).
  const cap = capPerSource(dd.items, perSourceCap(ctx.lookbackWindow));
  const cl = clusterSameStory(cap.items);
  const tf = topicFilter(cl.items, config);
  // After the toggles, so a merged story never lands in a section that's switched off.
  const xc = mergeAcrossCategories(tf.items);
  const lim = limitPerTopic(xc.items, perTopicLimit(ctx.lookbackWindow));

  const stats = {
    feedsAttempted: feeds.length,
    feedsOk: results.filter(r => r.status === 'ok').length,
    feedsEmpty: empty.length,
    feedsFailed: failed.length,
    xcancelSkipped: skippedXCancel,
    articlesFetched: articles.length,
    droppedShorts: cf.droppedShorts,
    droppedPromotional: cf.droppedPromo,
    droppedPerSourceCap: cap.capped,
    droppedOutsideWindow: win.dropped,
    windowFallbackUsed: win.usedFallback,
    droppedDuplicates: dd.duplicates,
    mergedIntoClusters: cl.merged,
    droppedTopicOff: tf.dropped,
    mergedAcrossCategories: xc.merged,
    droppedTopicLimit: lim.dropped,
    itemsKept: lim.items.length,
  };
  ctx.stats.ingest = stats;
  log.info(stats, 'ingestion complete');
  if (failed.length) log.warn({ dead: failed.map(f => ({ feed: f.feed, code: f.code })) }, `${failed.length} dead feeds`);

  recordFeedResults(ctx, results);
  return { items: lim.items, feedResults: results };
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
