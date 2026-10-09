import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { freshState } from './helpers.js';
import { buildApp } from '../src/server/app.js';
import { TOPICS, uiCatalog } from '../src/catalog/index.js';
import { EXTRA_FEEDS, FEED_OVERRIDES } from '../src/catalog/feeds.extra.js';

const LEGACY = path.resolve(__dirname, '../../digest-config.json');

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

  it('never lists the primary engine in its own fallback chain', async () => {
    const app = await buildApp();
    const put = await app.inject({ method: 'PUT', url: '/api/config', payload: { llm: { primary: 'claude', fallbackChain: ['claude', 'gemini', 'gemini', 'ollama'] } } });
    expect(put.json().config.llm.fallbackChain).toEqual(['gemini', 'ollama']);
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
