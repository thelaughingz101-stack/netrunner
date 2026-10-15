import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { freshState } from './helpers.js';
import { buildApp } from '../src/server/app.js';
import { TOPICS, uiCatalog } from '../src/catalog/index.js';
import { EXTRA_FEEDS, FEED_OVERRIDES } from '../src/catalog/feeds.extra.js';

const LEGACY = path.resolve(__dirname, '../reference/digest-config.json');

describe('config layer', () => {
  beforeEach(() => freshState({ LEGACY_CONFIG_PATH: LEGACY }));

  it('seeds from the legacy n8n config and strips secrets', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.statusCode).toBe(200);
    const { config, secrets } = res.json();
    expect(config.llm.apiKeys).toBeUndefined();
    expect(config.delivery.discordWebhookUrl).toBeUndefined();
    expect(JSON.stringify(config)).not.toMatch(/AQ\.Ab8|discord\.com\/api\/webhooks/);
    // values the user actually set survive
    expect(config.topics['Gaming']).toBe(false);
    expect(config.topics['AI & LLMs']).toBe(true);
    expect(config.delivery.textFile).toBe(true);
    expect(config.schedule.lookbackWindow).toBe('12h');
    // topics the n8n UI never had are filled in as enabled (matches n8n's `!== false`)
    expect(config.topics['World News']).toBe(true);
    expect(config.topics['Blindspot Analysis']).toBe(true);
    expect(secrets).toHaveProperty('gemini');
  });

  it('round-trips a PUT and bumps the version', async () => {
    const app = await buildApp();
    const { config, version } = (await app.inject({ method: 'GET', url: '/api/config' })).json();
    config.format.language = 'Spanish';
    config.llm.apiKeys = { gemini: 'should-not-be-stored' };
    const put = await app.inject({ method: 'PUT', url: '/api/config', payload: config });
    expect(put.statusCode).toBe(200);
    expect(put.json().version).toBeGreaterThan(version);
    const again = (await app.inject({ method: 'GET', url: '/api/config' })).json();
    expect(again.config.format.language).toBe('Spanish');
    expect(again.config.llm.apiKeys).toBeUndefined();
  });

  it('rejects invalid config with a 400 and field paths', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: '/api/config', payload: { schedule: { morningTime: '7am', timezone: 'Mars/Base' } } });
    expect(res.statusCode).toBe(400);
    const paths = res.json().issues.map((i: { path: string }) => i.path);
    expect(paths).toContain('schedule.morningTime');
    expect(paths).toContain('schedule.timezone');
  });

  it('drops Media Announcements (folded into TV & Movies) from saved topics and section order', async () => {
    const app = await buildApp();
    const put = await app.inject({ method: 'PUT', url: '/api/config', payload: {
      topics: { 'Media Announcements': true, 'TV & Movies': true },
      format: { sectionOrder: ['TV & Movies', 'Media Announcements', 'Gaming'] },
    } });
    const saved = put.json().config;
    expect(saved.topics).not.toHaveProperty('Media Announcements');
    expect(saved.format.sectionOrder).not.toContain('Media Announcements');
    expect(saved.format.sectionOrder.filter((t: string) => t === 'TV & Movies' || t === 'Gaming')).toEqual(['TV & Movies', 'Gaming']);
  });

  it('a new topic joins a saved section order next to its neighbour, not at the very end', async () => {
    const app = await buildApp();
    const old = TOPICS.filter(t => t !== 'Health' && t !== 'Custom Feeds').reverse(); // a customised order without Health
    const put = await app.inject({ method: 'PUT', url: '/api/config', payload: { format: { sectionOrder: old } } });
    const order: string[] = put.json().config.format.sectionOrder;
    expect(order.indexOf('Health')).toBe(order.indexOf('Science & Space') + 1);
    expect(order.filter(t => t !== 'Health')).toEqual(old);
  });

  it('Custom Feeds is in the section order exactly when there are custom sources (so opening Format changes nothing)', async () => {
    const app = await buildApp();
    const put = (customSources: object, sectionOrder: string[]) =>
      app.inject({ method: 'PUT', url: '/api/config', payload: { customSources, format: { sectionOrder } } }).then(r => r.json().config.format.sectionOrder as string[]);
    expect(await put({ rss: ['https://example.com/feed.xml'] }, ['Gaming'])).toContain('Custom Feeds');
    expect(await put({ rss: [] }, ['Gaming', 'Custom Feeds'])).not.toContain('Custom Feeds');
  });

  it('never lists the primary engine in its own fallback chain', async () => {
    const app = await buildApp();
    const put = await app.inject({ method: 'PUT', url: '/api/config', payload: { llm: { primary: 'claude', fallbackChain: ['claude', 'gemini', 'gemini', 'ollama'] } } });
    expect(put.json().config.llm.fallbackChain).toEqual(['gemini', 'ollama']);
  });

  describe('import settings (POST /api/config/import: check + fill defaults, never saves)', () => {
    it('accepts a NetRunner export, fills missing options, and does not save it', async () => {
      const app = await buildApp();
      const before = (await app.inject({ method: 'GET', url: '/api/config' })).json();
      const file = { app: 'NetRunner', kind: 'settings', exportedAt: '2026-10-14T12:00:00Z',
        config: { format: { language: 'Spanish' }, schedule: { morningTime: '06:30' }, llm: { apiKeys: { gemini: 'leaked' } } } };
      const res = await app.inject({ method: 'POST', url: '/api/config/import', payload: file });
      expect(res.statusCode).toBe(200);
      const { config } = res.json();
      expect(config.format.language).toBe('Spanish');
      expect(config.schedule.morningTime).toBe('06:30');
      expect(config.topics['World News']).toBe(true); // filled in
      expect(config.llm.apiKeys).toBeUndefined();     // secrets never come through
      const after = (await app.inject({ method: 'GET', url: '/api/config' })).json();
      expect(after.version).toBe(before.version);
      expect(after.config.format.language).not.toBe('Spanish');
    });

    it('accepts an old n8n digest-config.json and strips its secrets', async () => {
      const fs = await import('node:fs');
      const app = await buildApp();
      const res = await app.inject({ method: 'POST', url: '/api/config/import', payload: JSON.parse(fs.readFileSync(LEGACY, 'utf8')) });
      expect(res.statusCode).toBe(200);
      expect(JSON.stringify(res.json().config)).not.toMatch(/AQ\.Ab8|discord\.com\/api\/webhooks/);
    });

    it('rejects a file that is not NetRunner settings', async () => {
      const app = await buildApp();
      for (const payload of [{ hello: 'world' }, { app: 'NetRunner', kind: 'settings', config: 'nope' }, [1, 2]]) {
        const res = await app.inject({ method: 'POST', url: '/api/config/import', payload });
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
        expect(res.json().error).toMatch(/isn't a NetRunner settings file/);
      }
    });

    it('rejects invalid values with field paths', async () => {
      const app = await buildApp();
      const res = await app.inject({ method: 'POST', url: '/api/config/import', payload: { schedule: { morningTime: '7am' } } });
      expect(res.statusCode).toBe(400);
      expect(res.json().issues.map((i: { path: string }) => i.path)).toContain('schedule.morningTime');
    });
  });

  it('serves a catalog with every topic: the 158 deployed feeds, minus removed dead ones, plus additions', async () => {
    const cat = uiCatalog();
    expect(cat.topics).toEqual(TOPICS);
    const removed = Object.values(FEED_OVERRIDES).filter(o => o === null).length;
    expect(cat.feedCount).toBe(158 - removed + EXTRA_FEEDS.length);
    expect(cat.sources['World News']?.RSS).toContain('BBC World News');
    expect(cat.sources['Gaming']?.xCancel).toContain('Wario64');
  });
});
