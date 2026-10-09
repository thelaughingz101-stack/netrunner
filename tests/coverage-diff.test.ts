import { beforeEach, describe, expect, it } from 'vitest';
import { freshState } from './helpers.js';
import { normalizeConfig } from '../src/config/schema.js';
import { assignIds, diffCoverage, forcePlace, mergeRecovery, recoveryPrompt, removeUntaggedMentions, stripTags, withIdRule, ID_RULE } from '../src/pipeline/coverage/coverage.js';
import { ensureCoverage } from '../src/pipeline/coverage/index.js';
import { createRun } from '../src/pipeline/runs.js';
import { LLMError, type LLMRequest, type Provider } from '../src/pipeline/llm/types.js';
import { buildLlmPayload } from '../src/pipeline/prompt/index.js';
import { db } from '../src/db/db.js';
import type { Item } from '../src/pipeline/types.js';

const mk = (n: number): Item[] => assignIds(Array.from({ length: n }, (_, i) => ({
  mode: 'morning', source: `Src${i}`, category: 'Gaming', title: `Story ${i + 1}`, link: `https://x.dev/${i + 1}`, published: null, summary: '',
})));

const DIGEST = `## 🎮 Gaming
- [**Story 1**](https://x.dev/1) — one. *(Src0)* [#N001]
- [**Story 2**](https://x.dev/2) — two. *(Src1)* [#N002]
## 📋 Everything Else
_Nothing outside the above sections._
## 🗒️ EXCLUDED
- Story 3 (Src2) — reason: duplicate [#N003]
- Ghost (Nowhere) — reason: spam [#N999]`;

describe('ID assignment + diff', () => {
  it('assigns stable zero-padded ids in feed order', () => {
    expect(mk(3).map(i => i.id)).toEqual(['N001', 'N002', 'N003']);
    expect(assignIds(Array(1200).fill(mk(1)[0]))[1199].id).toBe('N1200');
  });

  it('finds every id, its placement, missing ids, and invented ids', () => {
    const r = diffCoverage(DIGEST, ['N001', 'N002', 'N003', 'N004', 'N005']);
    expect(Object.fromEntries(r.found)).toEqual({ N001: 'section', N002: 'section', N003: 'excluded' });
    expect(r.missing).toEqual(['N004', 'N005']);
    expect(r.unknown).toEqual(['N999']);
  });

  it('counts an item as placed in a section even if EXCLUDED also mentions it', () => {
    const r = diffCoverage(`## 🗒️ EXCLUDED\n- x [#N001]\n## 🎮 Gaming\n- y [#N001]`, ['N001']);
    expect(r.found.get('N001')).toBe('section');
  });

  it('injects the id rule into the system prompt and the Gemini systemInstruction', () => {
    const base = buildLlmPayload({ mode: 'morning', items: mk(2), morningDigest: '' }, normalizeConfig({}), []);
    const p = withIdRule(base);
    expect(p.system.endsWith(ID_RULE)).toBe(true);
    expect(p.geminiBody.systemInstruction.parts[0].text).toBe(p.system);
    expect(p.user).toContain('"id":"N001"'); // ids ride along inside the feed JSON
    expect(base.system).not.toContain(ID_RULE); // original untouched
  });

  it('recovery prompt carries only the missing items', () => {
    const base = buildLlmPayload({ mode: 'morning', items: mk(5), morningDigest: '' }, normalizeConfig({}), []);
    const r = recoveryPrompt(base, mk(5).slice(3));
    expect(r.user).toContain('MISSING FEED ITEMS (JSON) — 2 items');
    expect(r.user).toContain('"id":"N004"');
    expect(r.user).not.toContain('"id":"N001"');
    expect(r.geminiBody.contents[0].parts[0].text).toBe(r.user);
  });
});

describe('merge + force-place + strip', () => {
  it('merges recovered bullets into the matching section and the ledger', () => {
    const merged = mergeRecovery(DIGEST, `## 🎮 Gaming\n- [**Story 4**](https://x.dev/4) — four. *(Src3)* [#N004]\n## 🗒️ EXCLUDED\n- Story 5 (Src4) — reason: stale [#N005]`);
    const lines = merged.split('\n');
    const gaming = lines.indexOf('## 🎮 Gaming');
    expect(lines[gaming + 3]).toContain('[#N004]'); // appended after the existing two
    expect(merged.indexOf('[#N005]')).toBeGreaterThan(merged.indexOf('## 🗒️ EXCLUDED'));
    expect(diffCoverage(merged, ['N001', 'N002', 'N003', 'N004', 'N005']).missing).toEqual([]);
  });

  it('routes recovered items with an unknown header to Everything Else and clears its placeholder', () => {
    const merged = mergeRecovery(DIGEST, `## 🦄 Invented Section\n- [**Story 4**](u) — x. *(S)* [#N004]`);
    expect(merged).not.toContain('Invented Section');
    expect(merged).not.toContain('_Nothing outside the above sections._');
    const ee = merged.indexOf('## 📋 Everything Else');
    expect(merged.indexOf('[#N004]')).toBeGreaterThan(ee);
    expect(merged.indexOf('[#N004]')).toBeLessThan(merged.indexOf('## 🗒️ EXCLUDED'));
  });

  it('force-places leftovers deterministically and strips tags for delivery', () => {
    const out = forcePlace(DIGEST, mk(4).slice(3));
    expect(out).toContain('- [**Story 4**](https://x.dev/4) *(Src3)* [#N004]');
    expect(stripTags(out)).not.toMatch(/\[#N\d+\]/);
    expect(stripTags('- a *(S)* [#N001]')).toBe('- a *(S)*');
  });
});

describe('untagged duplicates (regression from the first live Gemini run)', () => {
  const items = assignIds([
    { mode: 'nightly', source: 'CBR', category: 'TV & Movies', title: "After 36 Years, Tim Burton’s 105-Minute Gothic Fairytale Returns as Halloween Streaming Hit",
      link: 'https://www.cbr.com/edward-scissorhands-fantasy-disney-plus-streaming-success-october-2026/', published: null, summary: '' },
    { mode: 'nightly', source: 'CBR', category: 'Anime', title: '4 Weakest Paramecia Devil Fruits in One Piece, Ranked',
      link: 'https://www.cbr.com/one-piece-weakest-paramecia/', published: null, summary: '' },
  ]);
  // First pass: Gemini put both in EXCLUDED but without tags (so the diff saw them as missing).
  const first = `## 🎬 TV & Movies
- [**Search-sourced box office report for the weekend**](https://variety.com/x) — big weekend. *(Variety)*
## 🗒️ EXCLUDED
- Edward Scissorhands Fantasy Disney Plus Streaming Success October 2026 (CBR) — reason: filler
- 4 Weakest Paramecia Devil Fruits in One Piece, Ranked (CBR) — reason: filler`;
  const recovery = `## 📋 Everything Else
- [**After 36 Years, Tim Burton’s 105-Minute Gothic Fairytale Returns as Halloween Streaming Hit**](https://www.cbr.com/edward-scissorhands-fantasy-disney-plus-streaming-success-october-2026/) — resurgence. *(CBR)* [#N001]
## 🗒️ EXCLUDED
- 4 Weakest Paramecia Devil Fruits in One Piece, Ranked (CBR) — reason: filler [#N002]`;

  it('removes the untagged copies (matched by headline or URL slug) before merging', () => {
    const { digest, removed } = removeUntaggedMentions(first, items);
    expect(removed).toBe(2);
    const merged = mergeRecovery(digest, recovery);
    expect(merged.match(/Paramecia/g)).toHaveLength(1);
    expect(merged.split('\n').filter(l => /scissorhands|tim burton/i.test(l))).toHaveLength(1); // one bullet for the item
    expect(merged).toContain('Search-sourced box office report'); // unrelated search item survives
    expect(diffCoverage(merged, ['N001', 'N002']).missing).toEqual([]);
  });

  it('the id rule now spells out the tagged ledger format', () => {
    expect(ID_RULE).toContain('reason: filler [#N042]');
  });
});

describe('ensureCoverage (end-to-end with a scripted LLM)', () => {
  beforeEach(() => freshState());
  const config = normalizeConfig({ llm: { primary: 'gemini', fallbackChain: [] } });

  function scripted(replies: (string | LLMError)[]) {
    const seen: LLMRequest[] = [];
    const p: Provider = {
      tier: 'gemini', unavailable: () => null,
      async call(req) { seen.push(req); const r = replies.shift(); if (r instanceof LLMError || r === undefined) throw r ?? new LLMError('done', false); return { text: r, finishReason: 'STOP', truncated: false, model: 'g' }; },
    };
    return { p, seen };
  }
  const opts = (p: Provider) => ({ providers: { gemini: p }, tries: 1, retryDelayMs: 0, sleep: async () => {} });

  it('re-runs ONLY for the missing ids and records placements', async () => {
    const items = mk(5);
    const ctx = createRun({ config, mode: 'morning', lookbackWindow: '12h', dryRun: true, trigger: 'cli', kind: 'digest' });
    const prompt = withIdRule(buildLlmPayload({ mode: 'morning', items, morningDigest: '' }, config, []));
    const { p, seen } = scripted([`## 🎮 Gaming\n- [**Story 4**](https://x.dev/4) — four. *(Src3)* [#N004]\n- [**Story 5**](https://x.dev/5) — five. *(Src4)* [#N005]`]);
    const out = await ensureCoverage(ctx, items, prompt, { tier: 'gemini', model: 'g', text: DIGEST, finishReason: 'STOP', truncated: false, attempts: [] }, opts(p));

    expect(seen).toHaveLength(1);
    expect(seen[0].kind).toBe('recovery');
    expect(seen[0].prompt.user).toContain('"id":"N004"');
    expect(seen[0].prompt.user).not.toContain('"id":"N001"');
    expect(out.forced).toBe(0);
    expect(Object.fromEntries(out.placements)).toMatchObject({ N001: 'section', N003: 'excluded', N004: 'recovered', N005: 'recovered' });
    const rows = db().prepare('SELECT item_id, placement FROM run_items WHERE run_id = ? ORDER BY item_id').all(ctx.runId);
    expect(rows).toHaveLength(5);
  });

  it('does a second round for stragglers, then force-places what is still missing', async () => {
    const items = mk(4);
    const ctx = createRun({ config, mode: 'morning', lookbackWindow: '12h', dryRun: true, trigger: 'cli', kind: 'digest' });
    const prompt = withIdRule(buildLlmPayload({ mode: 'morning', items, morningDigest: '' }, config, []));
    const { p, seen } = scripted([
      '## 🎮 Gaming\n- x *(Src3)* [#N004]',   // round 1: recovers N004, N003 still missing
      'nothing useful, no tags',             // round 2: recovers nothing → N003 force-placed
    ]);
    const first = '## 🎮 Gaming\n- a [#N001]\n- b [#N002]\n## 🗒️ EXCLUDED\nEXCLUDED: none';
    const out = await ensureCoverage(ctx, items, prompt, { tier: 'gemini', model: 'g', text: first, finishReason: 'STOP', truncated: false, attempts: [] }, opts(p));
    expect(seen).toHaveLength(2);
    expect(seen[1].prompt.user).toContain('"id":"N003"');
    expect(seen[1].prompt.user).not.toContain('"id":"N004"');
    expect(out.forced).toBe(1);
    expect(out.placements.get('N003')).toBe('forced');
    expect(diffCoverage(out.digest, items.map(i => i.id!)).missing).toEqual([]);
  });

  it('makes no extra LLM call when nothing is missing', async () => {
    const items = mk(3);
    const ctx = createRun({ config, mode: 'morning', lookbackWindow: '12h', dryRun: true, trigger: 'cli', kind: 'digest' });
    const { p, seen } = scripted([]);
    const out = await ensureCoverage(ctx, items, withIdRule(buildLlmPayload({ mode: 'morning', items, morningDigest: '' }, config, [])),
      { tier: 'gemini', model: 'g', text: DIGEST, finishReason: 'STOP', truncated: false, attempts: [] }, opts(p));
    expect(seen).toHaveLength(0);
    expect(out.rounds).toEqual([]);
  });

  it('still guarantees full coverage when the recovery call itself fails', async () => {
    const items = mk(5);
    const ctx = createRun({ config, mode: 'morning', lookbackWindow: '12h', dryRun: true, trigger: 'cli', kind: 'digest' });
    const { p } = scripted([new LLMError('quota', false)]);
    const out = await ensureCoverage(ctx, items, withIdRule(buildLlmPayload({ mode: 'morning', items, morningDigest: '' }, config, [])),
      { tier: 'gemini', model: 'g', text: DIGEST, finishReason: 'STOP', truncated: false, attempts: [] }, opts(p));
    expect(out.rounds[0].error).toMatch(/quota/);
    expect(out.forced).toBe(2);
    expect(diffCoverage(out.digest, items.map(i => i.id!)).missing).toEqual([]);
  });
});
