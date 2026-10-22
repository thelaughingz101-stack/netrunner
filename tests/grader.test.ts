// The digest grader and Feed health. Every check is tested both ways: a digest that should pass it and one that
// should fail it (a grader that only ever passes, or only ever fails, is broken).
import { beforeEach, describe, expect, it } from 'vitest';
import { freshState } from './helpers.js';
import { normalizeConfig } from '../src/config/schema.js';
import { db } from '../src/db/db.js';
import { log } from '../src/logger.js';
import { feedHealth, errorWords } from '../src/pipeline/feedHealth.js';
import { runCodeChecks } from '../src/pipeline/grade/checks.js';
import { getGrade, gradeDigest, saveGrade, scoreChecks } from '../src/pipeline/grade/index.js';
import { CRITERIA, graderConfig, judgePrompt, parseVerdicts, scoreVerdict } from '../src/pipeline/grade/judge.js';
import { parseDigest } from '../src/pipeline/grade/parse.js';
import type { LLMRequest, Provider } from '../src/pipeline/llm/types.js';

const GOOD = `## 🎮 Gaming
- [**Nintendo dates the Zelda remaster for March**](https://www.ign.com/zelda) — Nintendo announced the date in a Direct. *(IGN, Kotaku)*
- [**Valve updates Steam Deck firmware**](https://store.steampowered.com/news/1) — Battery fixes and a new performance overlay. *(Steam News)*
## 🩺 Health
- [**FDA recalls heart drug over contamination**](https://www.fda.gov/x) — The agency says three lots are affected. *(FDA, CNBC)*
## 📋 Everything Else
_Nothing outside the above sections._
## 🗒️ EXCLUDED
- Hello! (GBAtemp) — reason: filler`;

const BAD = `⚠️ **Some topics couldn't be written: Anime.** Their headlines are listed without summaries.

## 🩺 Health
- [**FDA recalls heart drug over contamination**](https://www.fda.gov/x) — The agency says three lots are affected. *(CNBC, FDA)* [#N004]
## 🎮 Gaming
- [**Nintendo dates the Zelda remaster for March**](https://www.ign.com/zelda) — Nintendo announced the date. *(IGN)*
- [**Nintendo dates the Zelda remaster for March**](https://www.ign.com/zelda) — Same story again. *(Kotaku)*
- [**Zelda Remaster | Official Clip**](https://news.google.com/rss/articles/CBMi) — A clip. *(Nintendo)*
- **Untitled rumor with no link** — Something happened.
## 🏛️ US Politics
- [**Senate passes budget**](https://apnews.com/x) — It passed. *(AP News)*
${'2'.repeat(300)}`;

const config = normalizeConfig({ topics: { 'US Politics': false }, format: { sectionOrder: ['Gaming', 'Health', 'US Politics'] } });
const checks = (md: string, runStats?: any) => Object.fromEntries(runCodeChecks({ digest: md, parsed: parseDigest(md), config, runStats }).map(c => [c.id, c]));

describe('reading a digest back', () => {
  it('finds sections, bullets, links and outlets; EXCLUDED lines are not graded bullets', () => {
    const p = parseDigest(GOOD);
    expect(p.sections.map(s => [s.kind, s.topic])).toEqual([['topic', 'Gaming'], ['topic', 'Health'], ['else', null], ['excluded', null]]);
    expect(p.bullets).toHaveLength(3);
    expect(p.bullets[0]).toMatchObject({ n: 1, headline: 'Nintendo dates the Zelda remaster for March', link: 'https://www.ign.com/zelda', sources: ['IGN', 'Kotaku'], section: '🎮 Gaming' });
    expect(p.sections[3].excluded).toEqual(['- Hello! (GBAtemp) — reason: filler']);
  });
});

describe('code graders', () => {
  it('a clean digest passes every check', () => {
    const c = checks(GOOD, { coverage: { expected: 3, forced: 0 } });
    for (const [id, r] of Object.entries(c)) expect(r.pass, `${id}: ${r.summary}`).toBe(true);
    expect(scoreChecks(Object.values(c))).toEqual({ score: 100, verdict: 'pass' });
  });

  it('a broken digest fails each rule it breaks, with the offending lines as evidence', () => {
    const c = checks(BAD, { coverage: { expected: 20, forced: 4 }, llm: { calls: 3, failedTopics: ['Anime'] } });
    expect(c['sections-on']).toMatchObject({ pass: false, critical: true });
    expect(c['sections-on'].evidence[0]).toContain('US Politics');
    expect(c['section-order'].pass).toBe(false);
    expect(c.repeats.pass).toBe(false);
    expect(c.repeats.evidence[0]).toContain('repeats #2');
    expect(c['leftover-tags']).toMatchObject({ pass: false, critical: true });
    expect(c.loops).toMatchObject({ pass: false, critical: true });
    expect(c.filtered.pass).toBe(false);
    expect(c.links.evidence.join('\n')).toMatch(/Google News link[\s\S]*no link/);
    expect(c['official-first'].pass).toBe(false);
    expect(c.coverage).toMatchObject({ pass: false, score: 0.8 });
    expect(c['topics-written'].summary).toContain('Anime');
    expect(c['catch-all'].pass).toBe(false);
    expect(scoreChecks(Object.values(c)).verdict).toBe('fail');
  });

  it('partial credit: one problem among many bullets still scores high', () => {
    const many = ['## 🎮 Gaming', ...Array.from({ length: 49 }, (_, i) => `- [**Story ${i}**](https://x.dev/${i}) — x. *(IGN)*`), '- **No link here** — x. *(IGN)*', '## 📋 Everything Else', '## 🗒️ EXCLUDED'].join('\n');
    const c = checks(many);
    expect(c.links.score).toBeCloseTo(0.98);
    expect(c.links.pass).toBe(true); // 3% slack
  });

  // Calibrated on a real digest (2026-10-19): what looked like repeats were three different CDC stories all
  // linked to cdc.gov's news index, and ComicBookMovie items are linkless by the prompt's own rule.
  it('a shared link is a link problem, not a repeated story; ComicBookMovie items may have no link', () => {
    const md = ['## 🩺 Health',
      '- [**CDC launches overdose data channel**](https://www.cdc.gov/media/index.html) — x. *(CDC)*',
      '- [**Outbreak linked to alfalfa sprouts**](https://www.cdc.gov/media/index.html) — y. *(CDC)*',
      '## 🎬 TV & Movies',
      '- **Avengers: Doomsday rumor addressed** — z. *(ComicBookMovie)*',
      '- [**New trailer drops**](https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZ) — w. *(Variety)*',
      '## 📋 Everything Else', '## 🗒️ EXCLUDED'].join('\n');
    const c = checks(md);
    expect(c.repeats.pass).toBe(true);
    expect(c.links.evidence).toEqual([
      expect.stringContaining('same link as #1'),
      expect.stringContaining('Google search redirect'),
    ]);
  });

  it('salvages each criterion from a judge answer that was cut off mid-JSON', () => {
    const cut = '⚠️ Gemini response was truncated…\n\n{"same-story":{"reasoning":"x","issues":[],"verdict":"pass"},"right-section":{"reasoning":"x","issues":[{"bullets":[10],"why":"AI story"},{"bullets":[46],"why":"live-action film"},{"bullets":[9';
    const v = parseVerdicts(cut);
    expect(v['same-story']).toMatchObject({ issues: [], verdict: 'pass' });
    expect(v['right-section']).toMatchObject({ issues: [{ bullets: [10], why: 'AI story' }, { bullets: [46], why: 'live-action film' }], verdict: 'fail' });
    expect(v.attribution).toBeNull(); // never reached
  });

  it("checks that need what it doesn't have are skipped, not failed", () => {
    const c = runCodeChecks({ digest: GOOD, parsed: parseDigest(GOOD) });
    expect(c.find(x => x.id === 'sections-on')!.skipped).toBeTruthy();
    expect(c.find(x => x.id === 'coverage')!.skipped).toBeTruthy();
  });
});

describe('AI graders', () => {
  const sameStory = CRITERIA.find(c => c.id === 'same-story')!;
  const section = CRITERIA.find(c => c.id === 'right-section')!;
  const bullets = parseDigest(GOOD).bullets;

  it('one request, four criteria: each with its own rubric, a violation example and a non-violation example', () => {
    expect(CRITERIA.map(c => c.id)).toEqual(['same-story', 'right-section', 'attribution', 'filler']);
    for (const c of CRITERIA) {
      expect(c.rubric, c.id).toMatch(/CRITERION:/);
      expect(c.rubric, c.id).toMatch(/Example violation/);
      expect(c.rubric, c.id).toMatch(/Example non-violation/);
    }
  });

  it('reads each criterion from the JSON answer, even inside a code fence, and refuses garbage', () => {
    const v = parseVerdicts('```json\n{"same-story":{"reasoning":"r","issues":[{"bullets":[1,3],"why":"same"}],"verdict":"fail"},"filler":{"reasoning":"ok","issues":[],"verdict":"pass"}}\n```');
    expect(v['same-story']).toEqual({ reasoning: 'r', issues: [{ bullets: [1, 3], why: 'same' }], verdict: 'fail' });
    expect(v.filler).toEqual({ reasoning: 'ok', issues: [], verdict: 'pass' });
    expect(v['right-section']).toBeNull();
    expect(Object.values(parseVerdicts('no json here')).every(x => x === null)).toBe(true);
  });

  it('scores from the flagged bullets itself, and ignores flags on bullets that do not exist', () => {
    const r = scoreVerdict(section, bullets, { reasoning: '', verdict: 'fail', issues: [{ bullets: [2], why: 'Steam belongs in Tech' }, { bullets: [99], why: 'invented' }] }, 'm');
    expect(r).toMatchObject({ grader: 'ai', score: 1 - 1 / 3, pass: false });
    expect(r.evidence).toHaveLength(1);
    expect(r.evidence[0]).toContain('#2');
  });

  it('a repeated story counts its extra copies; a single bullet is not a repeat', () => {
    const r = scoreVerdict(sameStory, bullets, { reasoning: '', verdict: 'fail', issues: [{ bullets: [1, 3], why: 'same' }, { bullets: [2], why: 'alone' }] }, 'm');
    expect(r.score).toBeCloseTo(2 / 3);
    expect(r.summary).toContain('1 problem');
  });

  it('"unknown" is a skip, not a pass or a fail', () => {
    expect(scoreVerdict(section, bullets, { reasoning: '', verdict: 'unknown', issues: [] }, 'm').skipped).toBeTruthy();
  });

  it('prefers a different AI from the one that wrote the digest', () => {
    const cfg = normalizeConfig({ llm: { primary: 'gemini', fallbackChain: ['claude', 'ollama'] } });
    expect(graderConfig(cfg, 'gemini').llm).toMatchObject({ primary: 'claude', fallbackChain: ['ollama', 'gemini'] });
    expect(graderConfig(cfg).llm).toMatchObject({ primary: 'gemini' });
  });

  it('grades a digest end to end, read-only, and keeps the report', async () => {
    freshState({ GEMINI_API_KEY: 'k' });
    const asked: LLMRequest[] = [];
    const judge: Provider = {
      tier: 'gemini', unavailable: () => null,
      async call(req) {
        asked.push(req);
        const ok = { reasoning: 'checked', issues: [], verdict: 'pass' };
        return { text: JSON.stringify({ 'same-story': ok, 'right-section': { reasoning: 'checked', issues: [{ bullets: [2], why: 'Steam news is Tech' }], verdict: 'fail' }, attribution: ok, filler: ok }), finishReason: 'STOP', truncated: false, model: 'judge' };
      },
    };
    const cfg = normalizeConfig({ llm: { primary: 'gemini', fallbackChain: [] } });
    const report = await gradeDigest({ content: GOOD, config: cfg, runStats: { coverage: { expected: 3, forced: 0 } } }, { log, engine: { providers: { gemini: judge }, tries: 1 } });
    expect(asked.map(r => r.kind)).toEqual(['grade']); // one request for all four criteria
    for (const c of CRITERIA) expect(asked[0].prompt.user).toContain(`=== CRITERION "${c.id}" ===`);
    expect(report.checks.filter(c => c.grader === 'ai').map(c => [c.id, c.pass])).toEqual([['same-story', true], ['right-section', false], ['attribution', true], ['filler', true]]);
    expect(asked[0].prompt.geminiBody.generationConfig).toMatchObject({ responseMimeType: 'application/json', temperature: 0 });
    expect(asked[0].prompt.user).not.toContain('GBAtemp'); // EXCLUDED lines aren't graded
    expect(report.checks.find(c => c.id === 'right-section')).toMatchObject({ pass: false });
    expect(report.verdict).toBe('attention');
    expect(report.graderModel).toBe('gemini:judge');
    const id = (await import('../src/digests.js')).saveDigest({ date: '2026-10-22', mode: 'morning', content: GOOD });
    saveGrade(id, null, report);
    expect(getGrade(id)).toEqual(report);
  });
});

describe('Feed health', () => {
  beforeEach(() => freshState());
  const run = (id: string, at: string, results: [name: string, url: string, status: string, error?: string, newest?: string][]) => {
    db().prepare("INSERT INTO runs (id, trigger, kind, status, started_at) VALUES (?, 'schedule', 'digest', 'ok', ?)").run(id, at);
    const ins = db().prepare('INSERT INTO feed_results (run_id, feed_name, url, status, item_count, error, newest_at) VALUES (?, ?, ?, ?, 0, ?, ?)');
    for (const [name, url, status, error, newest] of results) ins.run(id, name, url, status, error ?? null, newest ?? null);
  };
  const KOTAKU = 'https://kotaku.com/rss', POLYGON = 'https://www.polygon.com/rss/index.xml', ESA = 'https://www.esa.int/rssfeed/TopNews';

  it('lists feeds failing or empty two runs in a row, and quiet ones; one bad run is a blip', () => {
    run('r1', '2026-10-20T07:00:00Z', [['Kotaku', KOTAKU, 'error', 'HTTP 404'], ['Polygon', POLYGON, 'ok', undefined, '2026-10-20T06:00:00Z'], ['ESA', ESA, 'empty']]);
    run('r2', '2026-10-21T07:00:00Z', [['Kotaku', KOTAKU, 'error', 'HTTP 404'], ['Polygon', POLYGON, 'error', 'HTTP 503'], ['ESA', ESA, 'empty']]);
    run('r3', '2026-10-22T07:00:00Z', [['Kotaku', KOTAKU, 'error', 'HTTP 404'], ['Polygon', POLYGON, 'ok', undefined, '2026-09-01T00:00:00Z'], ['ESA', ESA, 'empty']]);
    const h = feedHealth(normalizeConfig({}), new Date('2026-10-22T12:00:00Z'));
    expect(h.checkedAt).toBe('2026-10-22T07:00:00Z');
    expect(h.feedsChecked).toBe(3);
    expect(h.problems.map(p => [p.feed, p.problem, p.toggleKey, p.since])).toEqual([
      ['Kotaku', 'failing', 'Kotaku', '2026-10-20T07:00:00Z'],
      ['ESA', 'empty', 'ESA', '2026-10-20T07:00:00Z'],
      ['Polygon', 'quiet', 'Polygon', '2026-09-01T00:00:00Z'],
    ]);
    expect(h.problems[0].detail).toBe('not found (404): the feed moved or was removed');
    expect(h.problems[2].detail).toBe('last story 51 days ago');
  });

  it('leaves out feeds that are switched off now, and says nothing before the first run', () => {
    expect(feedHealth(normalizeConfig({}))).toEqual({ checkedAt: null, feedsChecked: 0, problems: [] });
    run('r1', '2026-10-21T07:00:00Z', [['Kotaku', KOTAKU, 'error', 'HTTP 404']]);
    run('r2', '2026-10-22T07:00:00Z', [['Kotaku', KOTAKU, 'error', 'HTTP 404']]);
    expect(feedHealth(normalizeConfig({ sources: { Kotaku: false } })).problems).toEqual([]);
  });

  it('puts fetch errors in plain words', () => {
    expect(errorWords('HTTP 403')).toMatch(/^blocked/);
    expect(errorWords('TimeoutError: aborted')).toBe('timed out');
    expect(errorWords('HTTP 502')).toMatch(/server error/);
  });
});
