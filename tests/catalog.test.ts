import { describe, expect, it } from 'vitest';
import { BUILTIN_FEEDS, SOURCE_MAP, TOPICS, YOUTUBE_AUTHORS, feedKind, uiCatalog } from '../src/catalog/index.js';
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

  it('retries rate limits and YouTube 404 blips, but not ordinary 404s', () => {
    expect(isTransient(419, 'https://news.ycombinator.com/rss')).toBe(true);
    expect(isTransient(429, 'https://www.reddit.com/r/news/.rss')).toBe(true);
    expect(isTransient(404, 'https://www.youtube.com/feeds/videos.xml?channel_id=UCx')).toBe(true);
    expect(isTransient(404, 'https://example.com/feed')).toBe(false);
    expect(isTransient(403, 'https://example.com/feed')).toBe(false);
  });
});
