// 2026-10-22: Bluesky sources, official bodies first, "changed since?" feed requests, Google News links swapped
// for the publishers' own, and the run time limit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { freshState } from './helpers.js';
import { feedKind, uiCatalog } from '../src/catalog/index.js';
import { normalizeConfig } from '../src/config/schema.js';
import { saveConfig } from '../src/config/store.js';
import { log } from '../src/logger.js';
import { memoryFeedCache } from '../src/pipeline/ingest/feedCache.js';
import { fetchFeeds } from '../src/pipeline/ingest/fetchFeeds.js';
import { clusterSameStory, mergeAcrossCategories } from '../src/pipeline/ingest/filters.js';
import { googleNewsId, resolveGoogleNewsLinks, urlFromBatchResponse } from '../src/pipeline/ingest/googleNews.js';
import { normalize, tagSource, titleFromText } from '../src/pipeline/ingest/normalize.js';
import { AllTiersFailedError, generate } from '../src/pipeline/llm/engine.js';
import { LLMError, type LLMRequest, type Provider } from '../src/pipeline/llm/types.js';
import { run } from '../src/pipeline/run.js';
import type { Item } from '../src/pipeline/types.js';

const item = (p: Partial<Item>): Item => ({ mode: 'morning', source: 'S', category: 'Health', title: 't', link: 'l', published: null, summary: '', ...p });
const rss = (items: { title?: string; link: string; description?: string }[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items.map(i =>
    `<item>${i.title ? `<title>${i.title}</title>` : ''}<link>${i.link}</link><pubDate>${new Date().toUTCString()}</pubDate><description>${i.description ?? ''}</description></item>`).join('')}</channel></rss>`;

describe('Bluesky', () => {
  it('is its own kind of source, sharing the brand toggle, tagged by account', () => {
    expect(feedKind('https://bsky.app/profile/wario64.bsky.social/rss')).toBe('Bluesky');
    expect(uiCatalog().sources.Gaming?.Bluesky).toEqual(expect.arrayContaining(['Wario64', 'PlayStation', 'Valve']));
    expect(tagSource({ link: 'https://bsky.app/profile/wario64.bsky.social/post/3myhwmxnro22w' }).src).toEqual({ name: 'Wario64', category: 'Gaming' });
    expect(tagSource({ link: 'https://bsky.app/profile/culturecrave.co/post/x' }).src).toEqual({ name: 'Culture Crave', category: 'TV & Movies' });
  });

  it('posts have no title, so the first line of the text stands in', () => {
    expect(titleFromText('Deal: Elden Ring is $29.99 at Amazon\n\nhttps://amzn.to/x')).toBe('Deal: Elden Ring is $29.99 at Amazon');
    expect(titleFromText('Oblivion Remastered (Switch 2) restocked at PNP ($64.99) buff.ly/rjq1JsX #ad')).toBe('Oblivion Remastered (Switch 2) restocked at PNP ($64.99)');
    expect(titleFromText('METRO Redux update patch notes https://steamcommunity.com/games/1/x')).toBe('METRO Redux update patch notes');
    expect(titleFromText('https://x.dev/only-a-link\nThe actual words')).toBe('The actual words');
    const long = titleFromText(`${'word '.repeat(60)}end`);
    expect(long.length).toBeLessThanOrEqual(141);
    expect(long.endsWith('…')).toBe(true);
    const [it] = normalize([{ link: 'https://bsky.app/profile/wario64.bsky.social/post/1', contentSnippet: 'Switch 2 restock at Target\nlink' }], 'morning').items;
    expect(it).toMatchObject({ title: 'Switch 2 restock at Target', source: 'Wario64' });
  });
});

describe('official bodies first', () => {
  it('items from official bodies are marked', () => {
    const [fda, ign] = normalize([{ title: 'FDA recalls x', link: 'https://www.fda.gov/news-events/x' }, { title: 'y', link: 'https://www.ign.com/y' }], 'morning').items;
    expect(fda.official).toBe(true);
    expect(ign.official).toBeUndefined();
  });

  it('an official item leads the story it shares with the press: its link, title, and named first', () => {
    const press = item({ source: 'CNBC', title: 'FDA recalls popular heart drug over contamination', link: 'https://cnbc.com/x' });
    const agency = item({ source: 'FDA', title: 'FDA recalls heart drug over contamination risk', link: 'https://fda.gov/x', official: true });
    const [merged] = clusterSameStory([press, agency]).items;
    expect(merged).toMatchObject({ link: 'https://fda.gov/x', source: 'FDA, CNBC', official: true });
    const across = mergeAcrossCategories([
      item({ source: 'AP News', category: 'US Politics', title: 'Federal Reserve cuts interest rates by quarter point', link: 'https://ap.dev/x' }),
      item({ source: 'Federal Reserve', category: 'Business & Finance', title: 'Federal Reserve cuts interest rates quarter point statement', link: 'https://federalreserve.gov/x', official: true }),
    ]).items;
    expect(across).toHaveLength(1);
    expect(across[0]).toMatchObject({ link: 'https://federalreserve.gov/x', category: 'Business & Finance', source: 'Federal Reserve, AP News' });
  });

  it('the Start tab can tell which sources are official', () => {
    const { official } = uiCatalog();
    for (const k of ['FDA', 'Federal Reserve', 'NWS', 'UN News']) expect(official).toContain(k);
    expect(official).not.toContain('IGN');
  });
});

describe('"changed since?" feed requests', () => {
  it('sends the saved ETag / Last-Modified and reuses the saved answer on 304', async () => {
    const cache = memoryFeedCache();
    const sent: (Record<string, string> | undefined)[] = [];
    let call = 0;
    const fetchText = async (_url: string, _t: number, headers?: Record<string, string>) => {
      sent.push(headers);
      return ++call === 1
        ? { status: 200, text: rss([{ title: 'Hello', link: 'https://ign.com/hello' }]), etag: '"v1"', lastModified: 'Wed, 22 Oct 2026 10:00:00 GMT' }
        : { status: 304, text: '' };
    };
    const feeds = [{ name: 'IGN', category: 'Gaming', type: 'rss' as const, url: 'https://ign.com/feed' }];
    const first = await fetchFeeds(feeds, log, { fetchText, cache, tries: 1 });
    const second = await fetchFeeds(feeds, log, { fetchText, cache, tries: 1 });
    expect(sent).toEqual([undefined, { 'If-None-Match': '"v1"', 'If-Modified-Since': 'Wed, 22 Oct 2026 10:00:00 GMT' }]);
    expect(second.articles.map(a => a.title)).toEqual(first.articles.map(a => a.title));
    expect(second.results[0]).toMatchObject({ status: 'ok', unchanged: true, itemCount: 1 });
    expect(first.results[0].unchanged).toBeUndefined();
  });

  it('feeds that send neither header are not kept', async () => {
    const cache = memoryFeedCache();
    await fetchFeeds([{ name: 'x', category: 'Gaming', type: 'rss', url: 'u' }], log, { cache, tries: 1, fetchText: async () => ({ status: 200, text: rss([{ title: 'a', link: 'https://x.dev/a' }]) }) });
    expect(cache.entries.size).toBe(0);
  });
});

describe('Google News links', () => {
  beforeEach(() => freshState());
  const GN = (id: string) => `https://news.google.com/rss/articles/${id}?oc=5`;

  it("reads Google's answer", () => {
    expect(googleNewsId(GN('CBMiAbc_-1'))).toBe('CBMiAbc_-1');
    expect(googleNewsId('https://www.nsa.gov/x')).toBeNull();
    const answer = `)]}'\n\n[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://www.nsa.gov/press/x/\\",1]",null,null,null,""],["di",15]]`;
    expect(urlFromBatchResponse(answer)).toBe('https://www.nsa.gov/press/x/');
    expect(urlFromBatchResponse('garbage')).toBeNull();
  });

  it('swaps item and cluster links, asks once per article, and keeps the Google link when it fails', async () => {
    const asked: string[] = [];
    const resolve = async (id: string) => { asked.push(id); return id === 'bad' ? null : `https://agency.gov/${id}`; };
    const items = [item({ link: GN('a1'), clusterLinks: [GN('a1'), 'https://cnbc.com/x'] }), item({ link: GN('bad') }), item({ link: 'https://fda.gov/y' })];
    const first = await resolveGoogleNewsLinks(items, { resolve });
    expect(first.items.map(i => i.link)).toEqual(['https://agency.gov/a1', GN('bad'), 'https://fda.gov/y']);
    expect(first.items[0].clusterLinks).toEqual(['https://agency.gov/a1', 'https://cnbc.com/x']);
    expect(first.stats).toMatchObject({ lookedUp: 2, resolved: 1, failed: 1, fromCache: 0 });
    const again = await resolveGoogleNewsLinks([item({ link: GN('a1') })], { resolve });
    expect(again.items[0].link).toBe('https://agency.gov/a1');
    expect(asked).toEqual(['a1', 'bad']); // a1 came from the saved links the second time
  });
});

describe('run time limit', () => {
  const req: LLMRequest = {
    kind: 'digest',
    prompt: { mode: 'morning', system: 'S', user: 'U', geminiBody: { systemInstruction: { parts: [{ text: 'S' }] }, contents: [{ role: 'user', parts: [{ text: 'U' }] }], generationConfig: {} } },
  };
  const never: Provider = { tier: 'gemini', unavailable: () => null, call: async () => { throw new Error('should not be called'); } };

  it('starts no AI attempt once the run is out of time, and says so plainly', async () => {
    const err = await generate(req, normalizeConfig({ llm: { primary: 'gemini', fallbackChain: [] } }), log, { providers: { gemini: never }, deadline: Date.now() + 1000 })
      .catch(e => e);
    expect(err).toBeInstanceOf(AllTiersFailedError);
    expect(err.message).toMatch(/time limit/);
  });

  it('cuts a slow answer off at the deadline instead of waiting out the full timeout', async () => {
    const slow: Provider = { tier: 'gemini', unavailable: () => null, call: (_r, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new LLMError('aborted', true)))) };
    const t0 = Date.now();
    const err = await generate(req, normalizeConfig({ llm: { primary: 'gemini', fallbackChain: [] } }), log,
      { providers: { gemini: slow }, timeoutMs: 600_000, tries: 3, sleep: async () => {}, deadline: Date.now() + 300, minAttemptMs: 0 }).catch(e => e);
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(err.message).toMatch(/time limit/);
  });
});

describe('a topic call that breaks for a non-AI reason', () => {
  beforeEach(() => {
    freshState({ GEMINI_API_KEY: 'k', LLM_ITEMS_PER_CALL: 2, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'nr-m5-')) });
    saveConfig({ sources: {}, topics: { Gaming: true }, llm: { mode: 'llm', primary: 'gemini', fallbackChain: [] }, delivery: {} });
  });

  it('only loses that topic; the rest of the digest is still written', async () => {
    const fresh = new Date(Date.now() - 3600e3).toUTCString();
    const feed = (host: string, titles: string[]) => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${titles.map((t, i) =>
      `<item><title>${t}</title><link>https://www.${host}/${i}</link><pubDate>${fresh}</pubDate><description>d</description></item>`).join('')}</channel></rss>`;
    const fetchText = async (url: string) => url.includes('ign.com') ? { status: 200, text: feed('ign.com', ['Rockstar dates trailer', 'Nintendo Zelda remaster', 'Valve Deck firmware']) }
      : url.includes('theverge.com') ? { status: 200, text: feed('theverge.com', ['Framework motherboard', 'Raspberry Pi module']) } : { status: 404, text: '' };
    const gemini: Provider = {
      tier: 'gemini', unavailable: () => null,
      async call(r) {
        const ids = [...r.prompt.user.matchAll(/"id":"(N\d+)"/g)].map(m => m[1]);
        const topic = r.prompt.system.slice(r.prompt.system.indexOf('REQUIRED HEADER ORDER')).split('\n').find(l => l.startsWith('## ') && !/Everything Else|EXCLUDED/.test(l)) ?? '## 📋 Everything Else';
        return { text: `${topic}\n${ids.map(id => `- [**Story ${id}**](u) — x. *(S)* [#${id}]`).join('\n')}\n## 📋 Everything Else\n_None._\n## 🗒️ EXCLUDED\nEXCLUDED: none`, finishReason: 'STOP', truncated: false, model: 'g' };
      },
    };
    let starts = 0;
    const out: any = await run({
      trigger: 'cli', forceMode: 'morning', fetchText, feedTries: 1, targets: [],
      engine: { providers: { gemini }, tries: 1, onAttempt: () => { if (++starts === 2) throw new Error('progress write failed'); } },
    });
    expect(out.stats.llm.failedTopics).toHaveLength(1);
    expect(out.digest).toContain("Some topics couldn't be written");
  });
});

describe('Output search and the run forecast', () => {
  beforeEach(() => freshState());

  it('finds every digest that mentions a term, with its matching lines in plain text', async () => {
    const { saveDigest, searchDigests } = await import('../src/digests.js');
    saveDigest({ date: '2026-10-20', mode: 'morning', content: '## 🎮 Gaming\n- [**Zelda remaster dated**](https://x.dev/z) — Nintendo said so. *(IGN)*\n- [**Other**](u) — x.' });
    saveDigest({ date: '2026-10-21', mode: 'nightly', content: '## 🎮 Gaming\n- [**Nothing here**](u) — x.' });
    saveDigest({ date: '2026-10-22', mode: 'morning', content: '## 🔄 Story Updates\n- ZELDA: more news\n## 🎮 Gaming\n- 100% sure' });
    const hits = searchDigests('zelda');
    expect(hits.map(h => [h.date, h.matches])).toEqual([['2026-10-22', 1], ['2026-10-20', 1]]);
    expect(hits[1].lines).toEqual(['Zelda remaster dated — Nintendo said so. (IGN)']);
    expect(searchDigests('100%').map(h => h.date)).toEqual(['2026-10-22']); // % is a plain character, not a wildcard
    expect(searchDigests('  ')).toEqual([]);
  });

  it('forecasts stories and minutes for the settings on screen from recent runs', async () => {
    const { db } = await import('../src/db/db.js');
    const { estimateRun } = await import('../src/pipeline/estimate.js');
    expect(estimateRun(normalizeConfig({}))).toBeNull(); // no runs yet
    const d = db();
    d.prepare("INSERT INTO runs (id, trigger, kind, mode, lookback, dry_run, status, started_at, stats_json) VALUES ('r1', 'schedule', 'digest', 'morning', '12h', 0, 'ok', '2026-10-22T07:00:00Z', ?)")
      .run(JSON.stringify({ durationMs: 10 * 60_000, ingest: { itemsKept: 40 } }));
    const add = d.prepare("INSERT INTO run_items (run_id, item_id, source, category) VALUES ('r1', ?, ?, ?)");
    for (let i = 0; i < 6; i++) add.run(`I${i}`, 'IGN', 'Gaming');
    for (let i = 0; i < 4; i++) add.run(`F${i}`, 'FDA, CNBC', 'Health');
    const config = (over: object) => normalizeConfig({ schedule: { lookbackWindow: '12h' }, ...over });
    const gamingOnly = config({ topics: { Gaming: true, Health: false }, sources: { Kotaku: false } });
    const all = estimateRun(config({}))!;
    const some = estimateRun(gamingOnly)!;
    expect(all.runs).toBe(1);
    expect(some.stories).toBeLessThan(all.stories);
    expect(some.stories).toBeGreaterThanOrEqual(6);
    expect(estimateRun(config({ format: { digestSize: 'light' } }))!.stories).toBeLessThan(all.stories);
    expect(all.minutes).toBe(Math.round(all.stories * 10 / 40));
  });
});

describe('tidying the links in a written digest', () => {
  it("swaps Gemini's search redirects for the articles' own links, once per link; a failure keeps the redirect", async () => {
    const { resolveSearchRedirects } = await import('../src/pipeline/links.js');
    const r1 = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZ1=';
    const r2 = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZ2-x_y';
    const md = `- [**A**](${r1}) — a. *(Variety)*\n- [**B**](${r2}) — b.\n- [**A again**](${r1}) — c.`;
    const asked: string[] = [];
    const out = await resolveSearchRedirects(md, { follow: async u => { asked.push(u); return u === r1 ? 'https://variety.com/a' : null; } });
    expect(asked.sort()).toEqual([r1, r2].sort());
    expect(out).toMatchObject({ resolved: 1, failed: 1 });
    expect(out.md).toBe(`- [**A**](https://variety.com/a) — a. *(Variety)*\n- [**B**](${r2}) — b.\n- [**A again**](https://variety.com/a) — c.`);
  });

  it('names the outlet of a linked story that names none, from its address; leaves EXCLUDED alone', async () => {
    const { addMissingOutlets } = await import('../src/pipeline/links.js');
    const md = ['## 🏛️ US Politics',
      '- [**Senate passes budget**](https://apnews.com/article/x) — It passed.',
      '- [**Poll shows lows**](https://www.some-new-site.com/poll) — x.',
      '- [**Named already**](https://apnews.com/y) — y. *(AP News)*',
      '- Bare sentence with no link.',
      '## 🗒️ EXCLUDED',
      '- [**Skipped**](https://apnews.com/z) — reason: stale'].join('\n');
    const out = addMissingOutlets(md);
    expect(out.added).toBe(2);
    expect(out.md.split('\n')).toEqual(['## 🏛️ US Politics',
      '- [**Senate passes budget**](https://apnews.com/article/x) — It passed. *(AP News)*',
      '- [**Poll shows lows**](https://www.some-new-site.com/poll) — x. *(some-new-site.com)*',
      '- [**Named already**](https://apnews.com/y) — y. *(AP News)*',
      '- Bare sentence with no link.',
      '## 🗒️ EXCLUDED',
      '- [**Skipped**](https://apnews.com/z) — reason: stale']);
  });

  it('Billboard now lives in a Music topic, with music outlets beside it', () => {
    expect(tagSource({ link: 'https://www.billboard.com/music/chart-beat/x' }).src).toEqual({ name: 'Billboard', category: 'Music' });
    expect(uiCatalog().sources.Music?.RSS).toEqual(['Billboard', 'Rolling Stone Music', 'Pitchfork', 'Stereogum', 'Consequence', 'NME']);
    expect(uiCatalog().sources['Business & Finance']?.RSS).not.toContain('Billboard');
  });
});

describe('links that lead nowhere, and Gemini answers in pieces', () => {
  it('a search redirect Google says is dead loses its link but keeps its words', async () => {
    const { resolveSearchRedirects } = await import('../src/pipeline/links.js');
    const dead = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/DEAD1';
    const out = await resolveSearchRedirects(`- [**Saros launches**](${dead}) — out now. *(PlayStation Blog)*`, { follow: async () => 'dead' });
    expect(out).toMatchObject({ resolved: 0, unlinked: 1, failed: 0 });
    expect(out.md).toBe('- **Saros launches** — out now. *(PlayStation Blog)*');
  });

  it("joins Gemini's answer parts as they are, so a link cut between parts stays whole", async () => {
    const { geminiProvider } = await import('../src/pipeline/llm/gemini.js');
    freshState({ GEMINI_API_KEY: 'k' });
    const body = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '- [**Leak**](https' }, { text: '://www.reddit.com/r/x) — y.' }] } }] };
    const p = geminiProvider(async () => new Response(JSON.stringify(body), { status: 200 }));
    const out = await p.call({ kind: 'digest', prompt: { mode: 'm', system: 's', user: 'u', geminiBody: { systemInstruction: { parts: [{ text: 's' }] }, contents: [], generationConfig: {} } } }, AbortSignal.timeout(1000));
    expect(out.text).toBe('- [**Leak**](https://www.reddit.com/r/x) — y.');
  });
});

describe('your own Bluesky accounts', () => {
  it('reads a handle, an @handle, a bare name or a profile link', async () => {
    const { blueskyActor } = await import('../src/sources/blueskyResolve.js');
    expect(blueskyActor('@Wario64.bsky.social')).toBe('wario64.bsky.social');
    expect(blueskyActor('catsuka')).toBe('catsuka.bsky.social');
    expect(blueskyActor('https://bsky.app/profile/theverge.com/post/3abc')).toBe('theverge.com');
    expect(blueskyActor('did:plc:abc123')).toBe('did:plc:abc123');
    expect(blueskyActor('not a handle!')).toMatchObject({ error: expect.any(String) });
  });

  it('checks the account with Bluesky before adding it, and says plainly when it does not exist', async () => {
    const { resolveBluesky } = await import('../src/sources/blueskyResolve.js');
    const fake = (async (url: string) => url.includes('getProfile') && url.includes('real.bsky.social')
      ? new Response(JSON.stringify({ did: 'did:plc:real', handle: 'real.bsky.social', displayName: 'Real' }), { status: 200 })
      : url.includes('getAuthorFeed') ? new Response(JSON.stringify({ feed: [{ post: { indexedAt: '2026-10-22T10:00:00Z' } }] }), { status: 200 })
      : new Response('{}', { status: 400 })) as typeof fetch;
    expect(await resolveBluesky('real', fake)).toEqual({ handle: 'real.bsky.social', did: 'did:plc:real', title: 'Real', avatar: null, lastPost: '2026-10-22T10:00:00Z' });
    expect(await resolveBluesky('ghost', fake)).toEqual({ error: 'No Bluesky account called ghost.bsky.social.' });
  });

  it('is fetched by its permanent id, makes Custom Feeds a section, and its posts are named after the account', async () => {
    const { customFeeds } = await import('../src/pipeline/ingest/feedList.js');
    const config = normalizeConfig({ customSources: { bluesky: [{ did: 'did:plc:xyz', handle: 'someone.bsky.social', title: 'Someone' }] } });
    expect(customFeeds(config)).toEqual([expect.objectContaining({ name: '@someone.bsky.social', url: 'https://bsky.app/profile/did:plc:xyz/rss', category: 'Custom Feeds', custom: true })]);
    expect(config.format.sectionOrder).toContain('Custom Feeds');
    expect(tagSource({ link: 'https://bsky.app/profile/did:plc:xyz/post/1', _feed: '@someone.bsky.social' }).src).toEqual({ name: '@someone.bsky.social', category: 'Custom Feeds' });
  });

  it('X accounts with no Bluesky are covered by their own sites or channels, under the same toggle', () => {
    const tv = uiCatalog().sources['TV & Movies']!;
    for (const k of ['HBO', 'Disney', 'DC Universe']) expect([...(tv.YouTube ?? []), ...(tv.RSS ?? []), ...(tv.Bluesky ?? [])], k).toContain(k);
    expect(uiCatalog().sources['Tech & Hardware']?.RSS).toContain('Microsoft');
    expect(uiCatalog().sources['AI & LLMs']?.RSS).toContain('Rowan Cheung');
  });
});

describe('comics publishers and governments', () => {
  it("the Comics rules' publishers have their own sources, and the White House and the UK speak for themselves", () => {
    const comics = Object.values(uiCatalog().sources.Comics ?? {}).flat();
    for (const p of ['Marvel.com', 'DC.com', 'Dark Horse Comics', 'BOOM! Studios', 'Dynamite', 'IDW Publishing', 'Archie Comics', 'Fantagraphics', 'Mad Cave Studios', 'Skybound']) expect(comics, p).toContain(p);
    expect(tagSource({ link: 'https://www.whitehouse.gov/releases/2026/10/x/' }).src).toEqual({ name: 'White House', category: 'US Politics' });
    expect(tagSource({ link: 'https://www.gov.uk/government/news/x', _feed: 'UK Prime Minister' }).src).toEqual({ name: 'UK Prime Minister', category: 'World News' });
    expect(tagSource({ link: 'https://bsky.app/profile/houseoflords.parliament.uk/post/1' }).src).toEqual({ name: 'UK Parliament', category: 'World News' });
    const { official } = uiCatalog();
    for (const k of ['White House', 'UK Prime Minister', 'UK Parliament']) expect(official).toContain(k);
  });
});
