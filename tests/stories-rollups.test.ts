import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { freshState } from './helpers.js';
import { normalizeConfig } from '../src/config/schema.js';
import { saveDigest } from '../src/digests.js';
import { developingStories, headlinesFromRun, importLegacyTracker, updateTracker } from '../src/stories/tracker.js';
import { digestCorpus, monthlyPrompt, weeklyPrompt } from '../src/pipeline/rollups.js';
import { jobSpecs } from '../src/scheduler.js';
import type { Item } from '../src/pipeline/types.js';

describe('story tracker (SQLite port)', () => {
  beforeEach(() => freshState());

  it('matches the same story across days and flags it developing at 3 days', () => {
    updateTracker(['Rockstar reveals Grand Theft Auto trailer date'], '2026-10-06');
    updateTracker(['Grand Theft Auto trailer date confirmed by Rockstar'], '2026-10-07');
    expect(developingStories('2026-10-07')).toEqual([]);
    const r = updateTracker(['Rockstar Grand Theft Auto trailer drops today'], '2026-10-08');
    expect(r).toMatchObject({ matched: 1, created: 0, tracked: 1 });
    expect(developingStories('2026-10-08')).toEqual(['- "Rockstar Grand Theft Auto trailer drops today" (seen 3 days, first: 2026-10-06)']);
  });

  it('prunes days outside the 7-day window', () => {
    updateTracker(['Ancient story about something important'], '2026-09-01');
    const r = updateTracker(['Totally different fresh headline today'], '2026-10-08');
    expect(r.tracked).toBe(1);
  });

  it('takes headlines from placed items and untagged section bullets — never from EXCLUDED', () => {
    const items = [
      { id: 'N001', title: 'Kept item headline here [SHORT]' },
      { id: 'N002', title: 'Excluded item headline here' },
    ] as Item[];
    const digest = `## 🎮 Gaming
- [**Kept item headline here**](u) — x [#N001]
- [**Search sourced market headline**](u) — y
## 🗒️ EXCLUDED
- Excluded item headline here (Src) — reason: duplicate [#N002]
- Some search thing (Src) — reason: spam`;
    const h = headlinesFromRun(items, new Map([['N001', 'section'], ['N002', 'excluded']]), digest);
    expect(h).toEqual(['Kept item headline here', 'Search sourced market headline']);
    expect(h.join()).not.toMatch(/reason:/);
  });

  it('imports the legacy story-tracker.json and drops the junk entries', () => {
    const legacy = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../story-tracker.json'), 'utf8'));
    const r = importLegacyTracker(legacy);
    expect(r.imported + r.skipped).toBe(legacy.stories.length);
    expect(r.skipped).toBeGreaterThanOrEqual(11);
    expect(importLegacyTracker(legacy).imported).toBe(0); // idempotent
  });
});

describe('rollups', () => {
  beforeEach(() => freshState());
  const now = new Date('2026-10-11T16:00:00Z'); // Sunday

  it('weekly rollup gets the actual saved digests (not file paths) for the past 6 days', () => {
    saveDigest({ date: '2026-10-05', mode: 'morning', content: '## 🎮 Gaming\n- [**Old one**](u) — x' });
    saveDigest({ date: '2026-10-09', mode: 'nightly', content: '## 🎮 Gaming\n- [**Recent one**](u) — y' });
    saveDigest({ date: '2026-10-09', mode: 'nightly', content: 'dry', dryRun: true });
    const w = weeklyPrompt(now, 'America/New_York');
    expect(w.digestCount).toBe(2);
    expect(w.prompt.user).toContain('WEEKLY ROLLUP digest for the week of 2026-10-05 – 2026-10-10');
    expect(w.prompt.user).toContain('### 2026-10-09 — nightly\n## 🎮 Gaming\n- [**Recent one**]');
    expect(w.prompt.user).not.toContain('.n8n-files');
    expect(w.prompt.geminiBody.generationConfig).toEqual({ maxOutputTokens: 8192, temperature: 0.1, topP: 0.9 });
  });

  it('monthly recap counts real digests and falls back to headlines when too long', () => {
    for (let d = 1; d <= 9; d++) saveDigest({ date: `2026-10-0${d}`, mode: 'morning', content: `## S\n- **H${d}** — ${'long '.repeat(200)}` });
    const m = monthlyPrompt(now, 'America/New_York', 2000);
    expect(m.prompt.user).toContain('MONTHLY RECAP for October 2026');
    expect(m.prompt.user).toContain('TOTAL DIGEST FILES THIS MONTH: 9 (9 morning + 0 nightly)');
    expect(m.corpusMode).toBe('headlines');
    expect(m.prompt.user).not.toContain('long long');
  });

  it('digestCorpus keeps full text when it fits', () => {
    expect(digestCorpus([{ date: 'd', mode: 'morning', content: 'body' } as any], 1000)).toEqual({ text: '### d — morning\nbody', mode: 'full' });
  });
});

describe('scheduler job specs (driven by the Config UI Schedule tab)', () => {
  it('twice daily at the configured times, rollups only when enabled', () => {
    const jobs = jobSpecs(normalizeConfig({ schedule: { morningTime: '06:30', nightlyTime: '21:15' }, rollups: { weekly: true } }));
    expect(jobs.map(j => [j.name, j.cron, j.opts.forceMode])).toEqual([
      ['morning digest', '30 6 * * *', 'morning'],
      ['nightly digest', '15 21 * * *', 'nightly'],
      ['weekly rollup', '0 12 * * 0', 'weekly'],
    ]);
  });

  it('skipWeekends limits daily jobs to Mon–Fri; once_daily drops nightly', () => {
    const jobs = jobSpecs(normalizeConfig({ schedule: { frequency: 'once_daily', skipWeekends: true } }));
    expect(jobs).toEqual([{ name: 'morning digest', cron: '0 7 * * 1-5', when: { hour: 7, minute: 0, days: [1, 2, 3, 4, 5] }, opts: { forceMode: 'morning' } }]);
  });

  it('weekly frequency = one Sunday digest covering the week', () => {
    const jobs = jobSpecs(normalizeConfig({ schedule: { frequency: 'weekly', morningTime: '09:00' }, rollups: { monthly: true } }));
    expect(jobs).toEqual([
      { name: 'weekly digest', cron: '0 9 * * 0', when: { hour: 9, minute: 0, days: [0] }, opts: { forceMode: 'morning', lookbackWindow: '1w' } },
      { name: 'monthly recap', cron: '0 22 28 * *', when: { hour: 22, minute: 0, monthDay: 28 }, opts: { forceMode: 'monthly' } },
    ]);
  });
});
