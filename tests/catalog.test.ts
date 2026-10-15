import { describe, expect, it } from 'vitest';
import { BUILTIN_FEEDS, SOURCE_MAP, TOPICS, XCANCEL_USERS, YOUTUBE_AUTHORS, feedKind, uiCatalog } from '../src/catalog/index.js';
import { EXTRA_FEEDS, FEED_OVERRIDES } from '../src/catalog/feeds.extra.js';
import { isTransient } from '../src/pipeline/ingest/fetchFeeds.js';
import { tagSource } from '../src/pipeline/ingest/normalize.js';

describe('catalog additions and fixes', () => {
  it('applies feed overrides: patched URLs keep their name, null removes the feed', () => {
    const byName = (n: string) => BUILTIN_FEEDS.find(f => f.name === n);
    expect(byName('Unbox Therapy YouTube')?.url).toContain('UCsTcErHg8oDvUnTzoqsYeNw');
    expect(byName('Unbox Therapy YouTube')?.sourceKey).toBe('Unbox Therapy');
    expect(byName('VentureBeat AI')).toBeUndefined();
    expect(byName('Yahoo News')).toBeUndefined();
    for (const name of Object.keys(FEED_OVERRIDES)) expect(BUILTIN_FEEDS.filter(f => f.name === name).length).toBeLessThanOrEqual(1);
  });

  it('fetches every built-in feed over https, so nothing on the network can rewrite what the AI reads', () => {
    expect(BUILTIN_FEEDS.filter(f => !f.url.startsWith('https://')).map(f => `${f.name}: ${f.url}`)).toEqual([]);
  });

  it('every added feed has a tag in its own section, so items never fall into Custom Feeds', () => {
    const tagNames = new Map<string, string>();
    for (const t of [...Object.values(SOURCE_MAP), ...Object.values(YOUTUBE_AUTHORS)]) tagNames.set(t.name, t.category);
    for (const f of EXTRA_FEEDS) {
      const tag = f.sourceKey ?? f.name;
      expect(tagNames.get(tag), f.name).toBe(f.category);
      expect(TOPICS, f.name).toContain(f.category);
    }
  });

  it('added feed names are unique and Animation finally has fetchable sources', () => {
    // (The n8n catalog itself lists ComicBookMovie twice — under TV & Movies and Comics — kept verbatim.)
    const added = EXTRA_FEEDS.map(f => f.name);
    expect(new Set(added).size).toBe(added.length);
    for (const n of added) expect(BUILTIN_FEEDS.filter(f => f.name === n), n).toHaveLength(1);
    const animation = BUILTIN_FEEDS.filter(f => f.category === 'Animation' && feedKind(f.url) !== 'xCancel');
    expect(animation.length).toBeGreaterThanOrEqual(5);
    expect(uiCatalog().sources.Animation?.RSS).toContain('Cartoon Brew');
  });

  it('path keys split a shared domain across sections', () => {
    const tag = (link: string) => tagSource({ link }).src;
    expect(tag('https://arstechnica.com/science/2026/10/x/')).toMatchObject({ name: 'Ars Technica Science', category: 'Science & Space' });
    expect(tag('https://arstechnica.com/space/2026/10/x/')).toMatchObject({ category: 'Science & Space' });
    expect(tag('https://arstechnica.com/gadgets/2026/10/x/')).toMatchObject({ name: 'Ars Technica', category: 'Tech & Hardware' });
    expect(tag('https://github.com/ollama/ollama/releases/tag/v0.12.0')).toMatchObject({ name: 'Ollama Releases', category: 'AI & LLMs' });
    expect(tag('https://bleedingcool.com/comics/some-story/')).toMatchObject({ category: 'Comics' });
  });

  it('Google News items are tagged by their original publisher, not as one "Google News" source', () => {
    const gnews = (url: string) => tagSource({ link: 'https://news.google.com/rss/articles/CBMi?oc=5', source: [{ _: 'x', $: { url } }] }).src;
    expect(gnews('https://apnews.com')).toMatchObject({ name: 'AP News', category: 'US Politics' });
    expect(gnews('https://www.reuters.com')).toMatchObject({ name: 'Reuters' });
    expect(gnews('https://en.wikipedia.org')).toMatchObject({ name: 'Wikipedia', category: 'Notable Trends' });
    expect(tagSource({ link: 'https://news.google.com/rss/articles/CBMi' }).src.name).toBe('Google News');
  });

  it('Health: official public-health bodies, each item tagged to its agency', () => {
    expect(TOPICS).toContain('Health');
    const tag = (link: string, source?: string) => tagSource({ link, ...(source ? { source: [{ _: 'x', $: { url: source } }] } : {}) }).src;
    expect(tag('https://news.google.com/rss/articles/CBMi?oc=5', 'https://www.who.int')).toEqual({ name: 'WHO', category: 'Health' });
    expect(tag('https://news.google.com/rss/articles/CBMi?oc=5', 'https://www.nih.gov')).toEqual({ name: 'NIH', category: 'Health' });
    expect(tagSource({ link: 'https://www.youtube.com/watch?v=x', author: 'World Health Organization (WHO)' }).src).toEqual({ name: 'WHO', category: 'Health' });
    expect(tag('https://www.paho.org/en/news/9-10-2026-paho-assesses-risk')).toEqual({ name: 'PAHO', category: 'Health' });
    // CDC's feeds link through tools.cdc.gov; MMWR gets its own name (and its own per-source cap).
    expect(tag('https://tools.cdc.gov/api/embed/downloader/download.asp?m=132608&c=766495')).toEqual({ name: 'CDC', category: 'Health' });
    expect(tag('https://tools.cdc.gov/api/embed/downloader/download.asp?m=342778&c=766617')).toEqual({ name: 'CDC MMWR', category: 'Health' });
    expect(tag('http://www.fda.gov/news-events/press-announcements/fda-launches-x')).toEqual({ name: 'FDA', category: 'Health' });
    expect(tag('http://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts/x')).toEqual({ name: 'FDA Recalls', category: 'Health' });
    expect(tag('https://www.hhs.gov/press-room/x.html')).toEqual({ name: 'HHS', category: 'Health' });
    expect(tag('https://www.ecdc.europa.eu/en/news-events/x')).toEqual({ name: 'ECDC', category: 'Health' });
    expect(uiCatalog().sources.Health).toEqual({
      RSS: ['WHO', 'PAHO', 'CDC', 'CDC MMWR', 'FDA', 'FDA Recalls', 'NIH', 'HHS', 'ECDC'],
      YouTube: ['WHO'],
    });
  });

  it('Media Announcements is folded into TV & Movies, which now covers every major studio', () => {
    expect(TOPICS).not.toContain('Media Announcements');
    expect(BUILTIN_FEEDS.filter(f => f.category === 'Media Announcements')).toEqual([]);
    const tags = [...Object.values(SOURCE_MAP), ...Object.values(YOUTUBE_AUTHORS), ...Object.values(XCANCEL_USERS)];
    expect(tags.filter(t => !TOPICS.includes(t.category))).toEqual([]);
    for (const author of ['DC', 'Star Wars', 'Marvel Entertainment', 'Pixar', 'Universal Pictures', 'Sony Pictures Entertainment', 'Paramount Pictures', 'Lionsgate Movies']) {
      expect(tagSource({ link: 'https://www.youtube.com/watch?v=x', author }).src.category, author).toBe('TV & Movies');
    }
    expect(tagSource({ link: 'https://www.hollywoodreporter.com/movies/x/' }).src).toEqual({ name: 'Hollywood Reporter', category: 'TV & Movies' });
    const tv = uiCatalog().sources['TV & Movies'];
    for (const k of ['DC', 'Star Wars', 'Marvel Entertainment', 'Pixar', 'Universal Pictures', 'Sony Pictures', 'Paramount Pictures', 'Lionsgate']) expect(tv?.YouTube, k).toContain(k);
    expect(tv?.RSS).toContain('Hollywood Reporter');
  });

  it('the Sources tab spells out abbreviated names; every label belongs to a real source', () => {
    const { labels } = uiCatalog();
    expect(labels.WHO).toBe('World Health Organization (WHO)');
    expect(labels['CDC MMWR']).toBe('CDC Morbidity and Mortality Weekly Report (MMWR)');
    expect(labels.EFF).toBe('Electronic Frontier Foundation (EFF)');
    const keys = new Set(BUILTIN_FEEDS.map(f => f.sourceKey || f.name));
    for (const k of Object.keys(labels)) expect(keys.has(k), k).toBe(true);
    // Every Health source is an agency abbreviation, so each one needs its full name.
    for (const k of Object.values(uiCatalog().sources.Health ?? {}).flat()) expect(labels[k], k).toBeTruthy();
  });

  it('retries rate limits and YouTube 404 blips, but not ordinary 404s', () => {
    expect(isTransient(419, 'https://news.ycombinator.com/rss')).toBe(true);
    expect(isTransient(429, 'https://www.reddit.com/r/news/.rss')).toBe(true);
    expect(isTransient(404, 'https://www.youtube.com/feeds/videos.xml?channel_id=UCx')).toBe(true);
    expect(isTransient(404, 'https://example.com/feed')).toBe(false);
    expect(isTransient(403, 'https://example.com/feed')).toBe(false);
  });
});
