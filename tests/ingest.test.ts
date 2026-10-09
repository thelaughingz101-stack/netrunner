import { beforeEach, describe, expect, it } from 'vitest';
import { freshState } from './helpers.js';
import { normalizeConfig } from '../src/config/schema.js';
import { buildFeedList } from '../src/pipeline/ingest/feedList.js';
import { fetchFeeds } from '../src/pipeline/ingest/fetchFeeds.js';
import { normalize } from '../src/pipeline/ingest/normalize.js';
import { timeWindow, topicFilter } from '../src/pipeline/ingest/filters.js';
import { ingest } from '../src/pipeline/ingest/index.js';
import { createRun } from '../src/pipeline/runs.js';
import { resolveMode } from '../src/pipeline/mode.js';
import { log } from '../src/logger.js';
import type { Item, RawArticle } from '../src/pipeline/types.js';

const rss = (items: { title: string; link: string; date?: string; author?: string }[]) => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>t</title>${items.map(i =>
  `<item><title>${i.title}</title><link>${i.link}</link>${i.date ? `<pubDate>${new Date(i.date).toUTCString()}</pubDate>` : ''}${i.author ? `<author>${i.author}</author>` : ''}<description>&lt;p&gt;Body of ${i.title}&lt;/p&gt;</description></item>`).join('')}
</channel></rss>`;

describe('feed list', () => {
  it('skips xCancel, honors toggles, and injects custom sources', () => {
    const config = normalizeConfig({
      sources: { IGN: false },
      customSources: { rss: ['https://example.com/feed.xml'], youtube: [{ id: 'UC123', handle: '@me' }, 'UC456'], xcancel: ['someone'] },
    });
    const { feeds, skippedXCancel } = buildFeedList(config);
    expect(feeds.some(f => f.url.includes('xcancel.com'))).toBe(false);
    expect(skippedXCancel).toBeGreaterThanOrEqual(45);
    expect(feeds.some(f => f.sourceKey === 'IGN' || f.name === 'IGN')).toBe(false);
    expect(feeds.filter(f => f.custom).map(f => f.name)).toEqual(['Custom RSS', '@me', 'Custom YouTube']);
  });
});

describe('Normalize & Tag', () => {
  const a = (p: RawArticle): RawArticle => ({ title: 'x', ...p });

  it('tags by domain, reddit path, YouTube author, and falls back to Custom Feeds', () => {
    const { items } = normalize([
      a({ link: 'https://www.ign.com/articles/x' }),
      a({ link: 'https://www.reddit.com/r/worldnews/comments/1' }),
      a({ link: 'https://www.reddit.com/r/somethingelse/comments/1' }),
      a({ link: 'https://www.youtube.com/watch?v=1', author: 'Marques Brownlee' }),
      a({ link: 'https://unknown-blog.net/post' }),
    ], 'morning');
    expect(items.map(i => [i.source, i.category])).toEqual([
      ['IGN', 'Gaming'],
      ['Reddit r/worldnews', 'World News'],
      ['Reddit', 'Notable Trends'],
      ['Marques Brownlee', 'Tech & Hardware'],
      ['unknown-blog.net', 'Custom Feeds'],
    ]);
  });

  it('caps built-in sources at 8 but never caps Custom Feeds', () => {
    const ign = Array.from({ length: 12 }, (_, i) => a({ link: `https://ign.com/${i}` }));
    const custom = Array.from({ length: 12 }, (_, i) => a({ link: `https://my-blog.dev/${i}` }));
    const { items, capped } = normalize([...ign, ...custom], 'morning');
    expect(items.filter(i => i.source === 'IGN')).toHaveLength(8);
    expect(items.filter(i => i.category === 'Custom Feeds')).toHaveLength(12);
    expect(capped).toBe(4);
  });

  it('marks YouTube Shorts and strips HTML from summaries', () => {
    const { items } = normalize([a({ title: 'Clip', link: 'https://www.youtube.com/shorts/abc', author: 'IGN', content: '<b>hi</b> there' })], 'nightly');
    expect(items[0]).toMatchObject({ title: 'Clip [SHORT]', summary: 'hi there', mode: 'nightly' });
  });
});

describe('Time Window Filter', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const it2 = (published: string | null): Item => ({ mode: 'm', source: 's', category: 'c', title: 't', link: String(published), published, summary: '' });

  it('keeps items inside the window and items with unparseable dates', () => {
    const r = timeWindow([it2('2026-10-08T06:00:00Z'), it2('2026-10-07T06:00:00Z'), it2(null), it2('1971-01-01T00:00:00Z')], '12h', now);
    expect(r.items.map(i => i.published)).toEqual(['2026-10-08T06:00:00Z', null]);
    expect(r.dropped).toBe(2);
  });

  it('falls back to the newest 20 when everything is stale', () => {
    const old = Array.from({ length: 30 }, (_, i) => it2(new Date(now - (48 + i) * 3600e3).toISOString()));
    const r = timeWindow(old, '12h', now);
    expect(r.usedFallback).toBe(true);
    expect(r.items).toHaveLength(20);
    expect(r.items[0].published).toBe(old[0].published);
  });

  it('honors each lookback option', () => {
    const r = timeWindow([it2(new Date(now - 100 * 3600e3).toISOString())], '1w', now);
    expect(r.items).toHaveLength(1);
  });
});

describe('Topic Toggles', () => {
  it('drops categories toggled off, including Custom Feeds when it is off', () => {
    const config = normalizeConfig({ topics: { Gaming: false, 'Custom Feeds': false } });
    const items = ['Gaming', 'Anime', 'Custom Feeds'].map(category => ({ mode: 'm', source: 's', category, title: 't', link: category, published: null, summary: '' }));
    expect(topicFilter(items, config).items.map(i => i.category)).toEqual(['Anime']);
  });
});

describe('Set Mode', () => {
  const config = normalizeConfig({ schedule: { timezone: 'America/New_York' } });
  it('morning before noon local time, nightly after', () => {
    expect(resolveMode(config, {}, new Date('2026-10-08T13:00:00Z'))).toMatchObject({ mode: 'morning' }); // 09:00 ET
    expect(resolveMode(config, {}, new Date('2026-10-08T22:00:00Z'))).toMatchObject({ mode: 'nightly' }); // 18:00 ET
  });
  it('skips rollups that are switched off and honors lookback overrides', () => {
    expect(resolveMode(config, { forceMode: 'weekly' })).toMatchObject({ skip: true });
    expect(resolveMode(config, { lookbackWindow: '3d' })).toMatchObject({ lookbackWindow: '3d' });
  });
});

describe('fetch + full ingest (fake network)', () => {
  beforeEach(() => freshState());

  it('retries 5xx, does not retry 404, and parses RSS', async () => {
    const calls: Record<string, number> = {};
    const fetchText = async (url: string) => {
      calls[url] = (calls[url] || 0) + 1;
      if (url === 'u404') return { status: 404, text: '' };
      if (url === 'u503' && calls[url] < 2) return { status: 503, text: '' };
      return { status: 200, text: rss([{ title: 'Hello', link: 'https://ign.com/hello' }]) };
    };
    const feeds = ['u404', 'u503', 'ok'].map(url => ({ name: url, category: 'Gaming', type: 'rss' as const, url }));
    const { articles, results } = await fetchFeeds(feeds, log, { fetchText, tries: 3 });
    expect(calls).toEqual({ u404: 1, u503: 2, ok: 1 });
    expect(results.map(r => r.status)).toEqual(['error', 'ok', 'ok']);
    expect(articles[0]).toMatchObject({ title: 'Hello', link: 'https://ign.com/hello' });
  });

  it('runs every stage and records per-feed results', async () => {
    const now = new Date();
    const fresh = new Date(now.getTime() - 3600e3).toISOString();
    const config = normalizeConfig({
      sources: {}, // empty = all enabled (n8n semantics)
      topics: { Gaming: true, 'Custom Feeds': true },
      customSources: { rss: ['https://my-blog.dev/feed'] },
    });
    const ctx = createRun({ config, mode: 'morning', lookbackWindow: '12h', dryRun: true, trigger: 'cli', kind: 'digest', now });
    const fetchText = async (url: string) => {
      if (url === 'https://my-blog.dev/feed') return { status: 200, text: rss([{ title: 'My custom post', link: 'https://my-blog.dev/p1', date: fresh }]) };
      if (url.includes('ign.com')) return { status: 200, text: rss([
        { title: 'Rockstar reveals Grand Theft Auto trailer date', link: 'https://ign.com/gta', date: fresh },
        { title: 'Old news', link: 'https://ign.com/old', date: '2020-01-01T00:00:00Z' },
      ]) };
      return { status: 500, text: '' };
    };
    const { items, feedResults } = await ingest(ctx, { fetchText, tries: 1 });
    expect(items.map(i => i.title).sort()).toEqual(['My custom post', 'Rockstar reveals Grand Theft Auto trailer date']);
    expect(feedResults.filter(r => r.status === 'error').length).toBeGreaterThan(50);
    expect(ctx.stats.ingest).toMatchObject({ itemsKept: 2, droppedOutsideWindow: 1 });
  }, 60_000);
});

describe('Reddit (logged out: ~1 request per minute)', () => {
  it('fetches every enabled subreddit in one combined request', () => {
    const { feeds } = buildFeedList(normalizeConfig({}));
    const reddit = feeds.filter(f => f.url.includes('reddit.com'));
    expect(reddit).toHaveLength(1);
    expect(reddit[0].url).toBe('https://www.reddit.com/r/games+television+worldnews+news+outoftheloop+gamingleaksandrumours/.rss?limit=100');
    const leaksOnly = buildFeedList(normalizeConfig({ sources: { 'Reddit r/games': false, 'Reddit r/television': false, 'Reddit r/worldnews': false, 'Reddit r/news': false, 'Reddit r/outoftheloop': false } })).feeds;
    expect(leaksOnly.filter(f => f.url.includes('reddit.com')).map(f => f.url)).toEqual(['https://www.reddit.com/r/gamingleaksandrumours/.rss']);
  });

  it('tags posts by subreddit whatever the casing in the link', () => {
    const { items } = normalize([
      { title: 'a', link: 'https://www.reddit.com/r/GamingLeaksAndRumours/comments/1/a/' },
      { title: 'b', link: 'https://www.reddit.com/r/Games/comments/2/b/' },
    ], 'morning');
    expect(items.map(i => [i.source, i.category])).toEqual([
      ['Reddit r/gamingleaksandrumours', 'Leaks & Rumors'],
      ['Reddit r/games', 'Gaming'],
    ]);
  });

  it('on a 429, waits as long as the server says, then retries', async () => {
    let calls = 0;
    const t0 = Date.now();
    const fetchText = async () => (++calls === 1
      ? { status: 429, text: '', retryAfterSec: 1 }
      : { status: 200, text: rss([{ title: 'x', link: 'https://www.reddit.com/r/games/comments/3/x/' }]) });
    const { results } = await fetchFeeds([{ name: 'r', category: 'Gaming', type: 'rss', url: 'https://www.reddit.com/r/games/.rss' }], log, { fetchText, tries: 2 });
    expect(results[0].status).toBe('ok');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1900);
  });
});
