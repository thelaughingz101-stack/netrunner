import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '../src/config/schema.js';
import { contentFilter, isPromotionalTitle } from '../src/pipeline/ingest/filters.js';
import { jobSpecs } from '../src/scheduler.js';

describe('Shorts / promo filter', () => {
  // Real titles from the feeds (2026-10-08 runs).
  const promo = [
    'Luke Skywalker Meets R2-D2 and C-3PO | Official Clip',
    'ACE COMBAT 8: WINGS OF THEVE | Accolades Trailer',
    'The Crew Motorfest: Nintendo Switch 2 Launch Trailer',
    'Keep up. DIGGER is NOW PLAYING in theaters and IMAX.',
    'Ulta Promo Codes: Up to 20% Off in October 2026',
    'Inside the making of Dune | Featurette',
  ];
  const news = [
    'Machinarium 2 | Announcement Trailer',
    'The Talos Principle 3 - Gameplay Reveal Trailer | The Triple-i Initiative',
    'Crazy Rich Asians 2 Trailer Reveals Sequel Movie Is Actually a TV Show, Returning Cast Revealed',
    'Googlebook is now available on Mac through a clever virtual machine workaround',
    'Submit Your Short to This Italian Film Festival',
    'Xilam Promotes 3 Executives in Leadership Overhaul',
    'Alan Cumming & Tara Strong’s Bizarre New Fantasy Movie Arrives in Theaters Today',
  ];
  it.each(promo)('flags promo: %s', t => expect(isPromotionalTitle(t)).toBe(true));
  it.each(news)('keeps news: %s', t => expect(isPromotionalTitle(t)).toBe(false));

  const articles = [
    { title: 'Rubio declines to comment', link: 'https://www.youtube.com/shorts/abc' },
    { title: 'Hal is back #shorts', link: 'https://www.youtube.com/watch?v=x' },
    { title: 'Car Park Capital | Launch Trailer', link: 'https://www.youtube.com/watch?v=y' },
    { title: 'Real story', link: 'https://example.com/a' },
  ];

  it('drops Shorts and promo by default, and counts each', () => {
    const r = contentFilter(articles, normalizeConfig({}));
    expect(r.articles.map(a => a.title)).toEqual(['Real story']);
    expect(r).toMatchObject({ droppedShorts: 2, droppedPromo: 1 });
  });

  it('each toggle works on its own', () => {
    expect(contentFilter(articles, normalizeConfig({ filters: { shorts: false } })).articles).toHaveLength(3);
    expect(contentFilter(articles, normalizeConfig({ filters: { promotional: false } })).articles).toHaveLength(2);
    expect(contentFilter(articles, normalizeConfig({ filters: { shorts: false, promotional: false } })).articles).toHaveLength(4);
  });
});

describe('Scheduling on/off', () => {
  it('turning scheduling off removes every job, recaps included', () => {
    const on = normalizeConfig({ rollups: { weekly: true, monthly: true } });
    expect(jobSpecs(on).length).toBe(4);
    expect(jobSpecs(normalizeConfig({ ...on, schedule: { ...on.schedule, enabled: false } }))).toEqual([]);
  });
  it('defaults to on, so existing configs keep running', () => {
    expect(normalizeConfig({}).schedule.enabled).toBe(true);
  });
});

describe('EXCLUDED ledger toggle', async () => {
  const { stripExcluded } = await import('../src/pipeline/coverage/coverage.js');
  it('removes only the ledger section', () => {
    const md = '## 🎮 Gaming\n- a\n\n## 📋 Everything Else\n- b\n\n---\n\n## 🗒️ EXCLUDED\n- x — reason: filler\n- y — reason: stale\n';
    const out = stripExcluded(md);
    expect(out).toContain('- a');
    expect(out).toContain('- b');
    expect(out).not.toContain('EXCLUDED');
    expect(out).not.toContain('reason:');
  });
  it('defaults to shown, as before', () => expect(normalizeConfig({}).format.showExcluded).toBe(true));
});

describe('Everything Else / EXCLUDED hiding for deliveries', async () => {
  const { forDelivery } = await import('../src/pipeline/coverage/coverage.js');
  const md = '## 🕵️ Leaks & Rumors\n- leak\n\n## 📋 Everything Else\n- misc\n\n## 🗒️ EXCLUDED\n- x — reason: filler\n';
  it('drops only the sections switched off', () => {
    expect(forDelivery(md, { showExcluded: true, showEverythingElse: true })).toBe(md);
    const noElse = forDelivery(md, { showExcluded: true, showEverythingElse: false });
    expect(noElse).not.toContain('misc');
    expect(noElse).toContain('- leak');
    expect(noElse).toContain('reason: filler');
    const neither = forDelivery(md, { showExcluded: false, showEverythingElse: false });
    expect(neither.trim()).toBe('## 🕵️ Leaks & Rumors\n- leak');
  });
  it('defaults to shown', () => expect(normalizeConfig({}).format.showEverythingElse).toBe(true));
});
