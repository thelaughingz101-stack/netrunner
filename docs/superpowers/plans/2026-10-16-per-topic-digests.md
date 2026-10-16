# Per-topic digests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Big digests are written one AI call per topic and stitched back together; how much of each source and topic goes in grows with the catch-up range; repeated bullets are removed; overloaded AIs get longer retry waits; the Output tab's topics fold open and shut.

**Architecture:** Ingest gets two range-aware limits (`src/pipeline/ingest/limits.ts`). A pure planner/stitcher (`src/pipeline/split.ts`) decides the calls and merges the answers; an orchestrator (`src/pipeline/write.ts`) runs one call (small runs, unchanged behaviour) or one per topic, 3 at a time, each with its own coverage check, and replaces the inline generate+coverage code in `digestRun`. The prompt builder stays the verbatim n8n code: each call gets a copy of the config with only its topic on.

**Tech Stack:** TypeScript (Node 24, ESM), vitest, p-limit, better-sqlite3; UI is in-browser React 18 + Babel standalone in `public/netrunner-config.html`.

**Spec:** `docs/superpowers/specs/2026-10-16-per-topic-digests-design.md`

## Global Constraints

- **No `git commit` / `git push` until Zion has done his own UI check** (his standing preference; overrides the usual commit-per-task). Leave changes in the working tree on branch `oct15-health-setup-ui`.
- Never hand-edit `src/pipeline/prompt/generated/*`.
- Per-source cap by range: `12h 8, 24h 12, 3d 20, 1w 30, 2w 40, 1mo 50`; built-in sources only (Custom Feeds exempt); applied after the time window to newest-first items.
- Per-topic limit by range: `12h 25, 24h 30, 3d 40, 1w 55, 2w 65, 1mo 80`; rank by `clusterSize` (default 1) desc, then newest; Custom Feeds exempt.
- Split only when stories > `LLM_ITEMS_PER_CALL` (env, default 150); 3 calls in flight.
- Overload backoff for status 429/503/529 or "overloaded"/"high demand"/"RESOURCE_EXHAUSTED": `min(base × 3^(attempt−1), 120000)` (5 s, 15 s, 45 s, 2 min); other retryable errors keep the flat base delay.
- User-facing text is plain English (same voice as `src/pipeline/llm/explain.ts`).
- Verification: `npm run typecheck` and `npx vitest run` both clean before claiming done.

## Review Focus

1. Enabled topics with no feed stories when splitting (e.g. Blindspot Analysis): exactly one extra "search-only" call; no extra call when every enabled topic has stories. (Task 3 test)
2. Custom sources configured: only the Custom Feeds call may see `customSources`, or every call writes an empty 📡 Custom Feeds section. (Task 3 test)
3. Nightly runs: 🔄 Story Updates appears once, with the first call's content; other calls' empty placeholders are dropped. (Task 3 test)
4. Every per-topic call fails: the run fails with the plain-English reason, never a near-empty digest. (Task 4 test)
5. Stories with no parseable date in the per-topic ranking: ranked last, no NaN comparator chaos. (Task 1 test)

---

### Task 1: Range-aware limits in ingest

**Files:**
- Create: `src/pipeline/ingest/limits.ts`
- Modify: `src/pipeline/ingest/normalize.ts` (remove the cap), `src/pipeline/ingest/index.ts` (wire limits, stats), `src/catalog/index.ts` (drop the `PER_SOURCE_CAP` re-export)
- Test: `tests/limits.test.ts` (new), `tests/ingest.test.ts` (update the cap test, add ordering test)

**Interfaces:**
- Produces: `perSourceCap(lookback: string): number`, `perTopicLimit(lookback: string): number`, `capPerSource(items: Item[], cap: number): { items: Item[]; capped: number }`, `limitPerTopic(items: Item[], limit: number): { items: Item[]; dropped: number }`. `normalize(articles, mode)` now returns `{ items }` (no `capped`). `ctx.stats.ingest` gains `droppedTopicLimit`.

- [ ] **Step 1: Write the failing unit tests** — `tests/limits.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { capPerSource, limitPerTopic, perSourceCap, perTopicLimit } from '../src/pipeline/ingest/limits.js';
import type { Item } from '../src/pipeline/types.js';

const item = (p: Partial<Item>): Item => ({ mode: 'morning', source: 'IGN', category: 'Gaming', title: 't', link: 'l', published: '2026-10-16T10:00:00Z', summary: '', ...p });
const RANGES = ['12h', '24h', '3d', '1w', '2w', '1mo'];

describe('range-aware limits', () => {
  it('grow with the catch-up range, slowing down', () => {
    expect(RANGES.map(perSourceCap)).toEqual([8, 12, 20, 30, 40, 50]);
    expect(RANGES.map(perTopicLimit)).toEqual([25, 30, 40, 55, 65, 80]);
    expect(perSourceCap('nonsense')).toBe(8);
    expect(perTopicLimit('nonsense')).toBe(25);
  });

  it('per source: keeps the first N of each built-in source, never limits Custom Feeds', () => {
    const ign = Array.from({ length: 5 }, (_, i) => item({ title: `ign ${i}` }));
    const custom = Array.from({ length: 5 }, (_, i) => item({ source: 'my-blog.dev', category: 'Custom Feeds', title: `mine ${i}` }));
    const out = capPerSource([...ign, ...custom], 3);
    expect(out.items.map(i => i.title)).toEqual(['ign 0', 'ign 1', 'ign 2', 'mine 0', 'mine 1', 'mine 2', 'mine 3', 'mine 4']);
    expect(out.capped).toBe(2);
  });

  it('per topic: most outlets first, then newest; keeps the original order; Custom Feeds exempt', () => {
    const items = [
      item({ title: 'old single', published: '2026-10-16T01:00:00Z' }),
      item({ title: 'new single', published: '2026-10-16T09:00:00Z' }),
      item({ title: 'old big story', published: '2026-10-16T02:00:00Z', clusterSize: 3 }),
      item({ title: 'tech', category: 'Tech & Hardware' }),
      item({ title: 'mine', category: 'Custom Feeds' }),
      item({ title: 'mine 2', category: 'Custom Feeds' }),
    ];
    const out = limitPerTopic(items, 2);
    expect(out.items.map(i => i.title)).toEqual(['new single', 'old big story', 'tech', 'mine', 'mine 2']);
    expect(out.dropped).toBe(1);
  });

  it('per topic: a story without a date ranks last instead of breaking the sort', () => {
    const items = [item({ title: 'undated', published: null }), item({ title: 'dated', published: '2026-10-16T09:00:00Z' }), item({ title: 'garbage', published: 'not a date' })];
    expect(limitPerTopic(items, 1).items.map(i => i.title)).toEqual(['dated']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/limits.test.ts`
Expected: FAIL — `Cannot find module '../src/pipeline/ingest/limits.js'`.

- [ ] **Step 3: Implement** — `src/pipeline/ingest/limits.ts`

```ts
// How much of each source and of each topic goes into a digest, by catch-up range. Both grow with the
// range but slow down: a weekly digest gets more depth, not 14× a 12-hour one (chosen with Zion, 2026-10-16).
import type { Item } from '../types.js';

/** Newest stories kept per built-in source, inside the range (n8n always kept 8, whatever the range). */
export const PER_SOURCE_BY_RANGE: Record<string, number> = { '12h': 8, '24h': 12, '3d': 20, '1w': 30, '2w': 40, '1mo': 50 };
/** Stories kept per topic: the ones the most outlets covered, then the newest. */
export const PER_TOPIC_BY_RANGE: Record<string, number> = { '12h': 25, '24h': 30, '3d': 40, '1w': 55, '2w': 65, '1mo': 80 };

export const perSourceCap = (lookback: string) => PER_SOURCE_BY_RANGE[lookback] ?? PER_SOURCE_BY_RANGE['12h'];
export const perTopicLimit = (lookback: string) => PER_TOPIC_BY_RANGE[lookback] ?? PER_TOPIC_BY_RANGE['12h'];

/** Hand-picked by the user, so never limited. */
const EXEMPT = 'Custom Feeds';

/** Keeps each built-in source's first `cap` items. Give it newest-first items already inside the range. */
export function capPerSource(items: Item[], cap: number): { items: Item[]; capped: number } {
  const counts = new Map<string, number>();
  const out = items.filter(i => {
    if (i.category === EXEMPT) return true;
    const n = (counts.get(i.source) ?? 0) + 1;
    counts.set(i.source, n);
    return n <= cap;
  });
  return { items: out, capped: items.length - out.length };
}

/** Unparseable or missing dates count as oldest. */
const time = (i: Item) => {
  const t = Date.parse(i.published ?? '');
  return Number.isNaN(t) ? -Infinity : t;
};

/** Keeps each topic's `limit` best items (most outlets, then newest), in their original order. */
export function limitPerTopic(items: Item[], limit: number): { items: Item[]; dropped: number } {
  const keep = new Set<Item>();
  const byTopic = new Map<string, Item[]>();
  for (const i of items) {
    if (i.category === EXEMPT) { keep.add(i); continue; }
    if (!byTopic.has(i.category)) byTopic.set(i.category, []);
    byTopic.get(i.category)!.push(i);
  }
  for (const list of byTopic.values()) {
    [...list]
      .sort((a, b) => (b.clusterSize ?? 1) - (a.clusterSize ?? 1) || (time(b) > time(a) ? 1 : time(b) < time(a) ? -1 : 0))
      .slice(0, limit)
      .forEach(i => keep.add(i));
  }
  const out = items.filter(i => keep.has(i));
  return { items: out, dropped: items.length - out.length };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/limits.test.ts` — Expected: 4 passed.

- [ ] **Step 5: Move the per-source cap out of Normalize & Tag** — `src/pipeline/ingest/normalize.ts`

Remove `PER_SOURCE_CAP` from the import, delete `counts`/`capped` and the cap block inside the loop, and return `{ items: out }`:

```ts
import { SOURCE_MAP, XCANCEL_USERS, YOUTUBE_AUTHORS, type SourceTag } from '../../catalog/index.js';
// …
export function normalize(articles: RawArticle[], mode: string): { items: Item[] } {
  const out: Item[] = [];
  for (const a of articles) {
    const { link, src } = tagSource(a);
    let title = a.title || '';
    // (unchanged item construction)
  }
  return { items: out };
}
```

In `src/catalog/index.ts` drop `PER_SOURCE_CAP` from the import list and from `export { PER_SOURCE_CAP };` (leave the constant in the verbatim `sourceMap.generated.ts`).

- [ ] **Step 6: Wire the limits into ingest** — `src/pipeline/ingest/index.ts`

```ts
import { capPerSource, limitPerTopic, perSourceCap, perTopicLimit } from './limits.js';
// …
  const cf = contentFilter(articles, config);
  const norm = normalize(cf.articles, ctx.mode);
  const win = timeWindow(norm.items, ctx.lookbackWindow, ctx.now.getTime());
  const dd = dedupeAndSort(win.items);
  // After the window and newest-first: each source keeps its newest stories inside the range (n8n capped
  // first, so a source could fill its 8 with stories the window then threw away).
  const cap = capPerSource(dd.items, perSourceCap(ctx.lookbackWindow));
  const cl = clusterSameStory(cap.items);
  const tf = topicFilter(cl.items, config);
  // After the toggles, so a merged story never lands in a section that's switched off.
  const xc = mergeAcrossCategories(tf.items);
  const lim = limitPerTopic(xc.items, perTopicLimit(ctx.lookbackWindow));
```

Stats: `droppedPerSourceCap: cap.capped`, add `droppedTopicLimit: lim.dropped` after `mergedAcrossCategories`, `itemsKept: lim.items.length`; return `{ items: lim.items, feedResults: results }`. Update the pipeline comment above `ingest` to: `Feed List → RSS Read → Shorts/Promo filter → Normalize & Tag → Time Window → Dedup + Sort → Per-source cap → Clustering → Topic Toggles → Cross-category merge → Per-topic limit.`

- [ ] **Step 7: Update the old cap test and add the ordering test** — `tests/ingest.test.ts`

Replace `it('caps built-in sources at 8 but never caps Custom Feeds', …)` with:

```ts
  it('no longer caps: the per-source cap runs after the time window (limits.ts)', () => {
    const ign = Array.from({ length: 12 }, (_, i) => a({ link: `https://ign.com/${i}` }));
    const { items } = normalize(ign, 'morning');
    expect(items.filter(i => i.source === 'IGN')).toHaveLength(12);
  });
```

Add after `it('runs every stage and records per-feed results', …)`:

```ts
  it('caps each source after the time window, so old stories never use up its share', async () => {
    const now = new Date();
    const fresh = (h: number) => new Date(now.getTime() - h * 3600e3).toISOString();
    const config = normalizeConfig({ sources: {}, topics: { Gaming: true } });
    const ctx = createRun({ config, mode: 'morning', lookbackWindow: '12h', dryRun: true, trigger: 'cli', kind: 'digest', now });
    const words = ['zelda', 'halo', 'tetris', 'doom', 'kirby', 'metroid', 'portal', 'fallout', 'starfield'];
    const fetchText = async (url: string) => url.includes('ign.com')
      ? { status: 200, text: rss([{ title: 'Ancient archive story', link: 'https://ign.com/old', date: '2020-01-01T00:00:00Z' },
          ...words.map((w, i) => ({ title: `${w} ${w}ish ${w}ness report`, link: `https://ign.com/${w}`, date: fresh(i + 1) }))]) }
      : { status: 500, text: '' };
    const { items } = await ingest(ctx, { fetchText, tries: 1 });
    expect(items.filter(i => i.source === 'IGN')).toHaveLength(8); // 12h cap; n8n's order kept only 7
    expect(ctx.stats.ingest).toMatchObject({ droppedOutsideWindow: 1, droppedPerSourceCap: 1, droppedTopicLimit: 0 });
  }, 60_000);
```

- [ ] **Step 8: Run ingest + limits tests and typecheck**

Run: `npx vitest run tests/limits.test.ts tests/ingest.test.ts && npm run typecheck`
Expected: all pass, no type errors.

---

### Task 2: Longer retry waits when an AI is overloaded

**Files:**
- Modify: `src/pipeline/llm/engine.ts`
- Test: `tests/llm-chain.test.ts`

**Interfaces:**
- Produces: `retryDelay(base: number, attempt: number, status?: number, message?: string): number` (exported from `engine.ts`).

- [ ] **Step 1: Write the failing test** — add to `describe('LLM fallback chain', …)` in `tests/llm-chain.test.ts` (import `retryDelay` from `../src/pipeline/llm/engine.js`)

```ts
  it('waits longer each time an AI says it is overloaded or rate-limited (5 s, 15 s, 45 s, max 2 min)', async () => {
    expect([1, 2, 3, 4, 5].map(n => retryDelay(5000, n, 503))).toEqual([5000, 15000, 45000, 120000, 120000]);
    expect(retryDelay(5000, 3, 429)).toBe(45000);
    expect(retryDelay(5000, 2, undefined, 'claude 529 error: Overloaded')).toBe(15000);
    expect(retryDelay(5000, 3, 500)).toBe(5000);
    const waits: number[] = [];
    const g = scripted('gemini', [new LLMError('503 high demand', true, 503), new LLMError('503 high demand', true, 503), ok('done')]);
    await generate(req, cfg('gemini', []), log, { tries: 3, retryDelayMs: 5000, timeoutMs: 1000, sleep: async ms => { waits.push(ms); }, providers: { gemini: g.p } });
    expect(waits).toEqual([5000, 15000]);
  });
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/llm-chain.test.ts` → FAIL (`retryDelay` is not exported).

- [ ] **Step 3: Implement** — in `src/pipeline/llm/engine.ts`, below `tierOrder`:

```ts
/**
 * Wait before the next try. When the AI says it's overloaded or rate-limited, wait longer each time (5 s,
 * 15 s, 45 s, then 2 min) so a demand spike can pass: the 2026-10-16 08:00 run spent all 5 tries inside two
 * minutes of Gemini "high demand". Other retryable errors keep the flat delay.
 */
export function retryDelay(base: number, attempt: number, status?: number, message = ''): number {
  const busy = status === 429 || status === 503 || status === 529 || /overloaded|high demand|RESOURCE_EXHAUSTED/i.test(message);
  return busy ? Math.min(base * 3 ** (attempt - 1), 120_000) : base;
}
```

and in `generate` replace `await sleep(delay);` with `await sleep(retryDelay(delay, attempt, le.status, le.message));`.

- [ ] **Step 4: Run to verify it passes** — `npx vitest run tests/llm-chain.test.ts` → all pass.

---

### Task 3: Planning the per-topic calls and stitching the answers

**Files:**
- Create: `src/pipeline/split.ts`
- Modify: `src/pipeline/coverage/coverage.ts` (export `sections`, `headerKey`; add `plainBullet`, `dedupeBullets`; `forcePlace` uses `plainBullet`)
- Test: `tests/split.test.ts` (new)

**Interfaces:**
- Consumes: `TOPICS` (`src/catalog/index.ts`), `Config` (`src/config/schema.ts`), `Item` (`src/pipeline/types.ts`).
- Produces (coverage.ts): `sections(md: string): [string, string[]][]`, `headerKey(h: string): string`, `plainBullet(i: Item): string`, `dedupeBullets(md: string): { md: string; removed: number }`.
- Produces (split.ts): `SECTION_HEADERS: Record<string, string>`; `interface CallPlan { topics: string[]; items: Item[] }`; `planCalls(items: Item[], config: Config, limit: number): CallPlan[] | null`; `callConfig(config: Config, plan: CallPlan): Config`; `stitch(answers: string[]): string`; `plainSections(plan: CallPlan): string`; `failureNote(topics: string[], reason: string): string`.

- [ ] **Step 1: Write the failing tests** — `tests/split.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '../src/config/schema.js';
import { TOPICS } from '../src/catalog/index.js';
import { dedupeBullets } from '../src/pipeline/coverage/coverage.js';
import { buildLlmPayload } from '../src/pipeline/prompt/index.js';
import { callConfig, failureNote, plainSections, planCalls, SECTION_HEADERS, stitch } from '../src/pipeline/split.js';
import type { Item } from '../src/pipeline/types.js';

const item = (category: string, n: number): Item => ({ mode: 'morning', source: 'S', category, title: `${category} ${n}`, link: `https://x.dev/${category}/${n}`, published: null, summary: '', id: `N${category.length}${n}` });

describe('one AI call per topic (big digests)', () => {
  it('uses the same section headers as the AI Writer prompt', () => {
    const config = normalizeConfig({ customSources: { rss: ['https://my.dev/feed'] } });
    const p = buildLlmPayload({ mode: 'morning', items: [], morningDigest: '' }, config, []);
    const headers = p.system.slice(p.system.indexOf('REQUIRED HEADER ORDER')).split('\n').filter(l => l.startsWith('## '));
    for (const t of TOPICS) expect(headers, t).toContain(SECTION_HEADERS[t]);
  });

  it('stays one call up to the limit', () => {
    expect(planCalls([item('Gaming', 1), item('Health', 1)], normalizeConfig({}), 2)).toBeNull();
  });

  it('splits by topic in section order, plus one call for enabled topics that only have searches', () => {
    const config = normalizeConfig({ topics: Object.fromEntries(TOPICS.map(t => [t, ['Gaming', 'Health', 'Blindspot Analysis'].includes(t)])) });
    const items = [item('Health', 1), item('Gaming', 1), item('Gaming', 2)];
    const plans = planCalls(items, config, 2)!;
    expect(plans.map(p => [p.topics, p.items.length])).toEqual([[['Gaming'], 2], [['Health'], 1], [['Blindspot Analysis'], 0]]);
  });

  it('no extra call when every enabled topic has stories; Custom Feeds gets its own call', () => {
    const config = normalizeConfig({ topics: Object.fromEntries(TOPICS.map(t => [t, t === 'Gaming' || t === 'Custom Feeds'])), customSources: { rss: ['https://my.dev/feed'] } });
    const plans = planCalls([item('Gaming', 1), item('Custom Feeds', 1), item('Gaming', 2)], config, 2)!;
    expect(plans.map(p => p.topics)).toEqual([['Gaming'], ['Custom Feeds']]);
  });

  it("each call's config turns on only its topics, and custom feeds only for the Custom Feeds call", () => {
    const config = normalizeConfig({ customSources: { rss: ['https://my.dev/feed'] } });
    const gaming = callConfig(config, { topics: ['Gaming'], items: [] });
    expect(Object.entries(gaming.topics).filter(([, on]) => on).map(([t]) => t)).toEqual(['Gaming']);
    expect(gaming.customSources.rss).toEqual([]);
    expect(callConfig(config, { topics: ['Custom Feeds'], items: [] }).customSources.rss).toEqual(['https://my.dev/feed']);
  });

  it('stitches the answers: Story Updates once, topics in order, one Everything Else and one EXCLUDED', () => {
    const banner = '⚠️ Gemini response was truncated (hit MAX_TOKENS) before finishing. Raw partial output below:';
    const a = `${banner}\n\n## 🔄 Story Updates\n- [**Update**](u) — changed. *(S)*\n## 🎮 Gaming\n- [**G1**](u) — x. *(S)* [#N1]\n## 📋 Everything Else\n_Nothing outside the above sections._\n## 🗒️ EXCLUDED\n- Junk (S) — reason: filler [#N2]`;
    const b = `${banner}\n## 🔄 Story Updates\n_No updates._\n## 🩺 Health\n- [**H1**](u) — y. *(S)* [#N3]\n## 📋 Everything Else\n- [**E1**](u) — z. *(S)* [#N4]\n## 🗒️ EXCLUDED\nEXCLUDED: none`;
    const out = stitch([a, b]);
    expect(out.split('\n').filter(l => l.startsWith('## '))).toEqual(['## 🔄 Story Updates', '## 🎮 Gaming', '## 🩺 Health', '## 📋 Everything Else', '## 🗒️ EXCLUDED']);
    expect(out.startsWith(banner)).toBe(true);
    expect(out.match(/truncated/g)).toHaveLength(1);
    expect(out).not.toContain('_No updates._');
    expect(out).not.toContain('_Nothing outside');
    expect(out).not.toContain('EXCLUDED: none');
    expect(out).toContain('- [**E1**](u)');
    expect(out).toContain('- Junk (S) — reason: filler [#N2]');
  });

  it('keeps a placeholder when no answer had anything for that section', () => {
    const a = '## 🎮 Gaming\n- [**G1**](u) [#N1]\n## 📋 Everything Else\n_Nothing outside the above sections._';
    const b = '## 🩺 Health\n- [**H1**](u) [#N2]\n## 📋 Everything Else\n_Nothing outside the above sections._';
    expect(stitch([a, b])).toContain('## 📋 Everything Else\n_Nothing outside the above sections._');
  });

  it("a topic the AI couldn't write keeps its headlines, plainly, under its own header", () => {
    expect(plainSections({ topics: ['Health'], items: [item('Health', 1)] }))
      .toBe('## 🩺 Health\n- [**Health 1**](https://x.dev/Health/1) *(S)* [#N61]');
    expect(failureNote(['Health', 'Security'], 'No AI could write the digest:\n• Gemini was overloaded with requests (tries 1–5).'))
      .toBe("⚠️ **Some topics couldn't be written: Health, Security.** Their headlines are listed without summaries.\n• Gemini was overloaded with requests (tries 1–5).");
  });

  it('removes bullets an AI repeated word for word (tags and spacing ignored)', () => {
    const loop = ['## 🏛️ US Politics', '- [**A**](u) — a. *(BBC)* [#N1]', '- [**B**](u) — b. *(BBC)*', '- [**A**](u)  —  a. *(BBC)* [#N1]', '- [**B**](u) — b. *(BBC)*', 'Plain line', 'Plain line'];
    expect(dedupeBullets(loop.join('\n'))).toEqual({ md: ['## 🏛️ US Politics', '- [**A**](u) — a. *(BBC)* [#N1]', '- [**B**](u) — b. *(BBC)*', 'Plain line', 'Plain line'].join('\n'), removed: 2 });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/split.test.ts` → FAIL (`Cannot find module '../src/pipeline/split.js'`).

- [ ] **Step 3: Coverage helpers** — `src/pipeline/coverage/coverage.ts`

Change `function sections(md: string)` to `export function sections(md: string)` and `const headerKey = …` to `export const headerKey = …`. Add after `forcePlace`'s doc comment block (and make `forcePlace` use it):

```ts
/** A feed item as a plain headline bullet, no summary: "- [**Title**](link) *(Source)* [#N017]". */
export const plainBullet = (i: Item) => `- ${i.link ? `[**${i.title}**](${i.link})` : `**${i.title}**`} *(${i.source})* [#${i.id}]`;

/** Last resort: list still-missing items deterministically under Everything Else (no LLM summary). */
export function forcePlace(digest: string, items: Item[]): string {
  if (!items.length) return digest;
  return mergeRecovery(digest, `${EVERYTHING_ELSE_HEADER}\n${items.map(plainBullet).join('\n')}`);
}
```

Add after `stripTags`:

```ts
/**
 * Drops a bullet that repeats an earlier one word for word (tags and spacing ignored). An AI stuck in a loop
 * repeats lines until it runs out of room: on 2026-10-15 two US Politics bullets came back ~70 times.
 */
export function dedupeBullets(md: string): { md: string; removed: number } {
  const seen = new Set<string>();
  let removed = 0;
  const out = md.split('\n').filter(line => {
    if (!/^\s*[-*] /.test(line)) return true;
    const key = line.replace(TAG_RE, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (seen.has(key)) { removed++; return false; }
    seen.add(key);
    return true;
  });
  return { md: out.join('\n'), removed };
}
```

- [ ] **Step 4: The planner and stitcher** — `src/pipeline/split.ts`

```ts
// Big digests are written one topic per AI call (Zion, 2026-10-16): one call can't write ~560 stories
// (Gemini hit its output limit and looped). This file plans the calls and stitches their answers; write.ts
// runs them. Spec: docs/superpowers/specs/2026-10-16-per-topic-digests-design.md.
import { TOPICS } from '../catalog/index.js';
import type { Config } from '../config/schema.js';
import { headerKey, plainBullet, sections } from './coverage/coverage.js';
import type { Item } from './types.js';

/** Section headers exactly as Build LLM Payload writes them (tests/split.test.ts checks they still match). */
export const SECTION_HEADERS: Record<string, string> = {
  'US Politics': '## 🏛️ US Politics',
  'World News': '## 🌍 World News',
  'Business & Finance': '## 💼 Business & Finance',
  'AI & LLMs': '## 🤖 AI & LLMs',
  'Gaming': '## 🎮 Gaming',
  'Tech & Hardware': '## 🖥️ Tech & Hardware',
  'TV & Movies': '## 🎬 TV & Movies',
  'Anime': '## 🎌 Anime',
  'Animation': '## 🎨 Animation',
  'Science & Space': '## 🔭 Science & Space',
  'Health': '## 🩺 Health',
  'Security': '## 🔒 Security',
  'Comics': '## 📚 Comics',
  'Custom Feeds': '## 📡 Custom Feeds',
  'Notable Trends': '## 🔮 Notable Trends',
  'Blindspot Analysis': '## 👁️ Blindspot Analysis',
  'Leaks & Rumors': '## 🕵️ Leaks & Rumors',
};

export interface CallPlan {
  /** The topics this call writes: one, or every enabled topic that has no feed stories (searches only). */
  topics: string[];
  items: Item[];
}

/**
 * null = one call for everything (up to `limit` stories, as before). Otherwise one call per topic that has
 * stories, in the configured section order, plus one call for enabled topics that only have searches.
 */
export function planCalls(items: Item[], config: Config, limit: number): CallPlan[] | null {
  if (items.length <= limit) return null;
  const byTopic = new Map<string, Item[]>();
  for (const i of items) {
    if (!byTopic.has(i.category)) byTopic.set(i.category, []);
    byTopic.get(i.category)!.push(i);
  }
  const plans: CallPlan[] = [];
  const searchOnly: string[] = [];
  for (const topic of new Set([...config.format.sectionOrder, ...TOPICS, ...byTopic.keys()])) {
    const got = byTopic.get(topic);
    if (got?.length) plans.push({ topics: [topic], items: got });
    else if (topic !== 'Custom Feeds' && TOPICS.includes(topic) && config.topics[topic] !== false) searchOnly.push(topic);
  }
  if (searchOnly.length) plans.push({ topics: searchOnly, items: [] });
  return plans;
}

/** The run's config with only this call's topics on (their searches and rules follow), custom feeds only for the Custom Feeds call. */
export function callConfig(config: Config, plan: CallPlan): Config {
  const topics = Object.fromEntries(Object.keys(config.topics).map(t => [t, plan.topics.includes(t)]));
  const customSources = plan.topics.includes('Custom Feeds') ? config.customSources : { rss: [], youtube: [], xcancel: [] };
  return { ...config, topics, customSources };
}

const placeholder = (l: string) => /^_.*_$/.test(l.trim()) || /^EXCLUDED:\s*none\.?$/i.test(l.trim());
const trimBlank = (lines: string[]) => {
  let a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
};
/** Story Updates first, topics in answer order, then Everything Else, then EXCLUDED. */
const rank = (header: string) => /story updates/i.test(header) ? 0 : /everything else/i.test(header) ? 2 : /EXCLUDED/i.test(header) ? 3 : 1;

/**
 * One digest from the per-topic answers. Sections with the same header are merged. A placeholder line
 * ("_Nothing outside…_", "EXCLUDED: none") is kept only when no answer had anything for that section, so
 * nightly Story Updates comes from the one call that had the morning digest. Lines before the first header
 * (e.g. a truncation banner) are kept once each, at the top.
 */
export function stitch(answers: string[]): string {
  const preamble: string[] = [];
  const merged = new Map<string, { header: string; content: string[]; fallback: string[] }>();
  for (const answer of answers) {
    for (const [header, body] of sections(answer)) {
      if (!header) {
        for (const l of body) if (l.trim() && !preamble.includes(l)) preamble.push(l);
        continue;
      }
      const key = headerKey(header);
      if (!merged.has(key)) merged.set(key, { header, content: [], fallback: [] });
      const s = merged.get(key)!;
      const kept = trimBlank(body.filter(l => !placeholder(l)));
      if (kept.length) {
        if (s.content.length) s.content.push('');
        s.content.push(...kept);
      } else if (!s.fallback.length) {
        s.fallback.push(...trimBlank(body));
      }
    }
  }
  const ordered = [...merged.values()].sort((a, b) => rank(a.header) - rank(b.header));
  const body = ordered.map(s => [s.header, ...(s.content.length ? s.content : s.fallback)].join('\n')).join('\n\n');
  return (preamble.length ? `${preamble.join('\n')}\n\n${body}` : body).trim();
}

/** A call the AI couldn't write: its stories as plain headlines under their own topic headers. */
export function plainSections(plan: CallPlan): string {
  return plan.topics
    .map(t => {
      const items = plan.items.filter(i => i.category === t);
      return items.length ? [SECTION_HEADERS[t] ?? `## ${t}`, ...items.map(plainBullet)].join('\n') : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/** The note at the top of a digest when some topics couldn't be written: which, and why (explain.ts wording). */
export function failureNote(topics: string[], reason: string): string {
  const why = reason.split('\n').filter(l => l.startsWith('• '));
  return [`⚠️ **Some topics couldn't be written: ${topics.join(', ')}.** Their headlines are listed without summaries.`, ...why].join('\n');
}
```

- [ ] **Step 5: Run to verify it passes** — `npx vitest run tests/split.test.ts tests/coverage-diff.test.ts && npm run typecheck` → all pass.

---

### Task 4: Run the calls (one, or one per topic) and wire it into the digest run

**Files:**
- Create: `src/pipeline/write.ts`
- Modify: `src/pipeline/coverage/index.ts` (return `stats`, export `recordItems`), `src/pipeline/run.ts` (`digestRun` uses `writeDigest` + `dedupeBullets`), `src/env.ts` (`LLM_ITEMS_PER_CALL`), `.env.example`
- Test: `tests/pipeline-e2e.test.ts`

**Interfaces:**
- Consumes: Task 3's `planCalls`, `callConfig`, `stitch`, `plainSections`, `failureNote`, `dedupeBullets`; Task 2 unchanged `generate`; `attemptStage` (`src/pipeline/llm/explain.ts`).
- Produces: `writeDigest(ctx: RunContext, input: WriteInput, engine: EngineOptions): Promise<Written>` with `interface WriteInput { mode: Mode; items: Item[]; morningDigest: string; developing: string[] }` and `interface Written { digest: string; placements: CoverageOutcome['placements']; tier: Tier }`. `CoverageOutcome` gains `stats: CoverageStats`. `ctx.stats.llm` gains `calls` and `failedTopics` on split runs; `ctx.stats.coverage` gains `calls`.

- [ ] **Step 1: Write the failing end-to-end tests** — append inside `tests/pipeline-e2e.test.ts` (new `describe` at the end; add `LLMError` to the imports from `../src/pipeline/llm/types.js`)

```ts
describe('big runs: one AI call per topic', () => {
  const VERGE = `<?xml version="1.0"?><rss version="2.0"><channel><title>v</title>
<item><title>Framework unveils modular laptop motherboard</title><link>https://www.theverge.com/framework</link><pubDate>${fresh()}</pubDate><description>a</description></item>
<item><title>Raspberry Pi foundation ships compute module</title><link>https://www.theverge.com/pi</link><pubDate>${fresh()}</pubDate><description>b</description></item>
</channel></rss>`;
  const twoTopics = async (url: string) => url.includes('ign.com') ? { status: 200, text: RSS } : url.includes('theverge.com') ? { status: 200, text: VERGE } : { status: 404, text: '' };

  /** Writes every story it's given under the first topic header of the prompt; throws for prompts matching `failOn`. */
  function topicLlm(failOn?: RegExp) {
    const calls: LLMRequest[] = [];
    const stages: string[] = [];
    const p: Provider = {
      tier: 'gemini', unavailable: () => null,
      async call(req) {
        calls.push(req);
        const st = runStatus();
        if (st?.stage) stages.push(st.stage);
        if (failOn?.test(req.prompt.system)) throw new LLMError('gemini HTTP 503: high demand', false, 503);
        const ids = [...req.prompt.user.matchAll(/"id":"(N\d+)"/g)].map(m => m[1]);
        const headers = req.prompt.system.slice(req.prompt.system.indexOf('REQUIRED HEADER ORDER')).split('\n').filter(l => l.startsWith('## '));
        const topic = headers.find(h => !/Everything Else|EXCLUDED|Story Updates/.test(h)) ?? '## 📋 Everything Else';
        return { text: `${topic}\n${ids.map(id => `- [**Story ${id}**](u) — x. *(S)* [#${id}]`).join('\n')}\n## 📋 Everything Else\n_Nothing outside the above sections._\n## 🗒️ EXCLUDED\nEXCLUDED: none`, finishReason: 'STOP', truncated: false, model: 'g' };
      },
    };
    return { p, calls, stages };
  }

  beforeEach(() => {
    freshState({ GEMINI_API_KEY: 'k', LLM_ITEMS_PER_CALL: 2, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'nr-split-')) });
    saveConfig({ sources: {}, topics: { Gaming: true }, llm: { mode: 'llm', primary: 'gemini', fallbackChain: [] }, delivery: {} });
  });

  it('writes each topic in its own call and stitches them in section order', async () => {
    const llm = topicLlm();
    const out: any = await run({ trigger: 'cli', forceMode: 'morning', fetchText: twoTopics, feedTries: 1, engine: { providers: { gemini: llm.p }, tries: 1 }, targets: [] });
    expect(llm.calls.filter(c => c.kind === 'digest')).toHaveLength(3); // Gaming, Tech & Hardware, searches for the other topics
    const headers = out.digest.split('\n').filter((l: string) => l.startsWith('## '));
    expect(headers.indexOf('## 🎮 Gaming')).toBeLessThan(headers.indexOf('## 🖥️ Tech & Hardware'));
    expect(headers.filter((h: string) => /Everything Else/.test(h))).toHaveLength(1);
    expect(headers.at(-1)).toBe('## 🗒️ EXCLUDED');
    expect(out.digest).not.toMatch(/\[#N\d+\]/);
    expect(out.stats.llm).toMatchObject({ calls: 3 });
    expect(out.stats.coverage).toMatchObject({ calls: 3, expected: 5, forced: 0, finalAccounted: 5 });
    expect(llm.stages).toContain('Writing by topic: 0 of 3 done · Gaming: Writing the digest with Gemini');
  });

  it("a topic whose call fails still leaves the rest of the digest, with a note and plain headlines", async () => {
    const llm = topicLlm(/^## 🖥️ Tech & Hardware$/m);
    const out: any = await run({ trigger: 'cli', forceMode: 'morning', fetchText: twoTopics, feedTries: 1, engine: { providers: { gemini: llm.p }, tries: 1 }, targets: [] });
    expect(out.digest.startsWith("⚠️ **Some topics couldn't be written: Tech & Hardware.**")).toBe(true);
    expect(out.digest).toContain('• Gemini was overloaded with requests.');
    expect(out.digest).toContain('- [**Framework unveils modular laptop motherboard**](https://www.theverge.com/framework) *(The Verge)*');
    expect(out.digest).toContain('## 🎮 Gaming');
    expect(out.stats.llm).toMatchObject({ calls: 3, failedTopics: ['Tech & Hardware'] });
  });

  it('if every topic call fails, the run fails with the plain-English reason', async () => {
    const llm = topicLlm(/REQUIRED HEADER ORDER/);
    await expect(run({ trigger: 'cli', forceMode: 'morning', fetchText: twoTopics, feedTries: 1, engine: { providers: { gemini: llm.p }, tries: 1 }, targets: [] }))
      .rejects.toThrow(/No AI could write the digest/);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/pipeline-e2e.test.ts` → the three new tests FAIL (one call is made; `LLM_ITEMS_PER_CALL` unknown to the env schema type).

- [ ] **Step 3: The setting** — `src/env.ts`, after `LLM_RETRY_DELAY_MS: int(5_000),`:

```ts
  // More stories than this in one run → one AI call per topic (one call can't write ~560 stories).
  LLM_ITEMS_PER_CALL: int(150),
```

`.env.example`, after `LLM_RETRY_DELAY_MS=5000`:

```
# More stories than this in one run → the digest is written one topic per AI call, then stitched together.
LLM_ITEMS_PER_CALL=150
```

- [ ] **Step 4: Coverage returns its stats** — `src/pipeline/coverage/index.ts`

```ts
export interface CoverageStats {
  expected: number;
  firstPassMissing: number;
  unknownIdsInOutput: number;
  rounds: CoverageOutcome['rounds'];
  forced: number;
  finalAccounted: number;
}

export interface CoverageOutcome {
  digest: string;              // still tagged — strip before delivery
  placements: Map<string, 'section' | 'excluded' | 'recovered' | 'forced'>;
  rounds: { round: number; missingBefore: number; tier?: string; recovered: number; error?: string }[];
  forced: number;
  extraTiers: string[];
  /** Also stored as ctx.stats.coverage; returned because per-topic calls run concurrently. */
  stats: CoverageStats;
}
```

At the end of `ensureCoverage` replace the `ctx.stats.coverage = {…}` assignment and return with:

```ts
  const stats: CoverageStats = {
    expected: ids.length,
    firstPassMissing: initial.missing.length,
    unknownIdsInOutput: initial.unknown.length,
    rounds,
    forced: missing.length,
    finalAccounted: placements.size,
  };
  ctx.stats.coverage = stats;
  recordItems(ctx, items, placements);
  return { digest, placements, rounds, forced: missing.length, extraTiers, stats };
```

and change `function recordItems(` to `export function recordItems(`.

- [ ] **Step 5: The orchestrator** — `src/pipeline/write.ts`

```ts
// Writes the digest: one AI call (+ coverage recovery) for a normal run, one per topic for a big one
// (split.ts plans the calls and stitches the answers). Spec: docs/superpowers/specs/2026-10-16-per-topic-digests-design.md.
import pLimit from 'p-limit';
import type { Config } from '../config/schema.js';
import { env } from '../env.js';
import { ID_RULE, withIdRule } from './coverage/coverage.js';
import { ensureCoverage, recordItems, type CoverageOutcome, type CoverageStats } from './coverage/index.js';
import { AllTiersFailedError, generate, type EngineOptions } from './llm/engine.js';
import { attemptStage } from './llm/explain.js';
import type { AttemptLog, Tier } from './llm/types.js';
import { buildLlmPayload } from './prompt/index.js';
import { callConfig, failureNote, plainSections, planCalls, stitch, type CallPlan } from './split.js';
import type { Item, Mode, RunContext } from './types.js';

/** Calls in flight at once: Gemini's free tier allows about 10 requests a minute. */
const PARALLEL_CALLS = 3;

export interface WriteInput { mode: Mode; items: Item[]; morningDigest: string; developing: string[] }
export interface Written { digest: string; placements: CoverageOutcome['placements']; tier: Tier }

interface CallResult {
  digest: string;
  placements: CoverageOutcome['placements'];
  llm: { tier: Tier; model: string; finishReason: string | null; truncated: boolean; attempts: AttemptLog[] };
  coverage?: CoverageStats;
}

/** One AI call over these items, then the coverage check (recovery rounds) on its answer. */
async function writeOne(ctx: RunContext, config: Config, input: WriteInput, engine: EngineOptions): Promise<CallResult> {
  const prompt = withIdRule(buildLlmPayload({ mode: input.mode, items: input.items, morningDigest: input.morningDigest }, config, input.developing));
  const first = await generate({ kind: 'digest', prompt, idRule: ID_RULE }, config, ctx.log, engine);
  const llm = { tier: first.tier, model: first.model, finishReason: first.finishReason, truncated: first.truncated, attempts: first.attempts };
  if (!input.items.length) return { digest: first.text, placements: new Map(), llm };
  const cov = await ensureCoverage(ctx, input.items, prompt, first, engine);
  return { digest: cov.digest, placements: cov.placements, llm, coverage: cov.stats };
}

export async function writeDigest(ctx: RunContext, input: WriteInput, engine: EngineOptions): Promise<Written> {
  const plans = planCalls(input.items, ctx.config, env().LLM_ITEMS_PER_CALL);
  if (!plans) {
    const one = await writeOne(ctx, ctx.config, input, engine);
    ctx.stats.llm = one.llm;
    return { digest: one.digest, placements: one.placements, tier: one.llm.tier };
  }

  const total = plans.length;
  let done = 0;
  const progress = (extra = '') => ctx.progress?.(`Writing by topic: ${done} of ${total} done${extra}`);
  const label = (p: CallPlan) => (p.items.length ? p.topics.join(', ') : 'searches for the other topics');
  ctx.log.info({ calls: total, stories: input.items.length }, 'big digest: one AI call per topic');
  progress();

  const limit = pLimit(PARALLEL_CALLS);
  const results = await Promise.all(plans.map((plan, i) => limit(async () => {
    const callEngine: EngineOptions = { ...engine, onAttempt: a => { engine.onAttempt?.(a); progress(` · ${label(plan)}: ${attemptStage(a)}`); } };
    try {
      // The morning digest and developing stories go to the first call only, so Story Updates is written once.
      const r = await writeOne(ctx, callConfig(ctx.config, plan), {
        mode: input.mode, items: plan.items, morningDigest: i === 0 ? input.morningDigest : '', developing: i === 0 ? input.developing : [],
      }, callEngine);
      return { plan, r };
    } catch (err) {
      if (!(err instanceof AllTiersFailedError)) throw err;
      ctx.log.warn({ topics: plan.topics, err: err.message }, 'topic call failed — listing its headlines without summaries');
      return { plan, err };
    } finally {
      done++;
      progress();
    }
  })));

  const ok = results.filter((x): x is { plan: CallPlan; r: CallResult } => 'r' in x);
  const failed = results.filter((x): x is { plan: CallPlan; err: AllTiersFailedError } => 'err' in x);
  if (!ok.length) throw failed[0].err;

  const placements: CoverageOutcome['placements'] = new Map(ok.flatMap(x => [...x.r.placements]));
  const failedItems = failed.flatMap(f => f.plan.items);
  for (const it of failedItems) placements.set(it.id!, 'forced');
  if (failedItems.length) recordItems(ctx, failedItems, placements);

  let digest = stitch(results.map(x => ('r' in x ? x.r.digest : plainSections(x.plan))));
  if (failed.length) digest = `${failureNote(failed.flatMap(f => f.plan.topics), failed[0].err.message)}\n\n${digest}`;

  const first = ok[0].r.llm;
  ctx.stats.llm = {
    ...first,
    truncated: ok.some(x => x.r.llm.truncated),
    attempts: results.flatMap(x => ('r' in x ? x.r.llm.attempts : x.err.attempts)),
    calls: total,
    failedTopics: failed.flatMap(f => f.plan.topics),
  };
  const covs = ok.map(x => x.r.coverage).filter((c): c is CoverageStats => !!c);
  const sum = (k: 'expected' | 'firstPassMissing' | 'unknownIdsInOutput' | 'forced' | 'finalAccounted') => covs.reduce((n, c) => n + c[k], 0);
  ctx.stats.coverage = {
    calls: total,
    expected: sum('expected') + failedItems.length,
    firstPassMissing: sum('firstPassMissing'),
    unknownIdsInOutput: sum('unknownIdsInOutput'),
    rounds: covs.flatMap(c => c.rounds),
    forced: sum('forced') + failedItems.length,
    finalAccounted: sum('finalAccounted') + failedItems.length,
  };
  return { digest, placements, tier: first.tier };
}
```

- [ ] **Step 6: Use it in the digest run** — `src/pipeline/run.ts`, `digestRun`

Replace the block from `const prompt = withIdRule(buildLlmPayload(…` through `const digest = stripTags(coverage.digest);` with:

```ts
    const written = await writeDigest(ctx, { mode, items, morningDigest, developing }, engine);
    // Repeated bullets come from an AI stuck in a loop; drop them whatever the run size.
    const digest = dedupeBullets(stripTags(written.digest)).md;
```

and below it use `written.placements` / `written.digest` for the story tracker (`headlinesFromRun(items, written.placements, written.digest)`) and `llmTier: written.tier` in the return value. Imports: add `import { writeDigest } from './write.js';`, add `dedupeBullets` to the `./coverage/coverage.js` import, and remove the now-unused `ensureCoverage`, `ID_RULE`, `withIdRule`, `generate` and `buildLlmPayload` imports if nothing else in `run.ts` uses them (`generate` is still used by `rollupRun`; `buildManualPrompt` stays).

- [ ] **Step 7: Run to verify it passes** — `npx vitest run tests/pipeline-e2e.test.ts && npm run typecheck` → all pass (the existing single-call tests too: 3 stories ≤ 150).

- [ ] **Step 8: Full suite** — `npx vitest run` → all pass.

---

### Task 5: Collapsible topics in the Output tab

**Files:**
- Modify: `public/netrunner-config.html` (helper `splitSections`, `OutputTab` reader, `MD_STYLE`)
- Test: `tests/ui.test.ts`

**Interfaces:**
- Produces: `splitSections(md: string): { pre: string; sections: { title: string; key: string; count: number; body: string }[] }` (in the page script).

- [ ] **Step 1: Write the failing test** — append to `describe('uniformity pass (Oct 2026)', …)` in `tests/ui.test.ts`

```ts
  it('Output: each topic folds open and shut, with Collapse all / Expand all, remembered between visits', () => {
    expect(src).toContain('function splitSections');
    expect(src).toMatch(/<details[^>]*className="md-sec"/);
    expect(src).toContain('Collapse all');
    expect(src).toContain('Expand all');
    expect(src).toContain('nr_collapsed');
  });
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/ui.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `public/netrunner-config.html`

After `viewDigest`, add:

```js
// A digest's "## " sections, for the fold-out reader. pre = anything before the first header (banners, notes).
function splitSections(md) {
  const pre = [], raw = [];
  for (const line of (md || "").split("\n")) {
    if (/^##\s/.test(line)) raw.push({ title: line.replace(/^##\s*/, ""), lines: [] });
    else (raw.length ? raw[raw.length - 1].lines : pre).push(line);
  }
  return {
    pre: pre.join("\n").trim(),
    sections: raw.map(s => ({
      title: s.title,
      key: s.title.replace(/[^\p{L}\p{N}&]+/gu, " ").trim().toLowerCase(),
      count: s.lines.filter(l => /^- /.test(l)).length,
      body: s.lines.join("\n"),
    })),
  };
}
```

In `OutputTab`, after `const view = …`:

```js
  const parts = view ? splitSections(view.text) : null;
  // Folded sections, remembered by name (e.g. keep Comics folded every day). Storage may be unavailable.
  const [collapsed, setCollapsed] = useState(() => { try { return JSON.parse(localStorage.getItem("nr_collapsed") || "{}"); } catch { return {}; } });
  const saveCollapsed = next => { setCollapsed(next); try { localStorage.setItem("nr_collapsed", JSON.stringify(next)); } catch {} };
  const toggleSection = (key, closed) => { if (!!collapsed[key] !== closed) saveCollapsed({ ...collapsed, [key]: closed || undefined }); };
  const readerBtn = { ...s.btn, fontSize:13, padding:"6px 12px", background:"transparent", color:C.muted, border:`1px solid ${C.border}` };
```

In the reading pane's button row (the `div` holding the HIDEABLE Show/Hide buttons), before the HIDEABLE map:

```jsx
                    {parts && parts.sections.length > 1 && <>
                      <button onClick={() => saveCollapsed(Object.fromEntries(parts.sections.map(sec => [sec.key, true])))} style={readerBtn}>Collapse all</button>
                      <button onClick={() => saveCollapsed({})} style={readerBtn}>Expand all</button>
                    </>}
```

Replace `<div className="md-reader" dangerouslySetInnerHTML={{ __html: renderMD(view.text) }} />` with:

```jsx
                <div className="md-reader">
                  {parts.pre && <div dangerouslySetInnerHTML={{ __html: renderMD(parts.pre) }} />}
                  {parts.sections.map(sec => (
                    <details key={sec.key} className="md-sec" open={!collapsed[sec.key]} onToggle={e => toggleSection(sec.key, !e.currentTarget.open)}>
                      <summary className="md-sum">{sec.title}{sec.count > 0 && <span className="md-count">{sec.count}</span>}</summary>
                      <div dangerouslySetInnerHTML={{ __html: renderMD(sec.body) }} />
                    </details>
                  ))}
                </div>
```

Append to `MD_STYLE` (inside the template string):

```css
.md-sec{margin:1.3em 0 0;}
.md-sum{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:1.22em;font-weight:700;padding-bottom:.35em;margin-bottom:.55em;border-bottom:1px solid #2c1d20;color:#f3eeec;user-select:none;}
.md-sum::-webkit-details-marker{display:none;}
.md-sum::before{content:"▾";color:#ff6d3a;font-size:.8em;transition:transform .15s;}
details:not([open])>.md-sum{margin-bottom:0;}
details:not([open])>.md-sum::before{transform:rotate(-90deg);}
.md-sum:hover{color:#ff6d3a;}
.md-count{font-family:'IBM Plex Mono',monospace;font-size:.58em;font-weight:400;color:#857579;border:1px solid #2c1d20;border-radius:3px;padding:1px 6px;}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run tests/ui.test.ts` → all pass (includes the Babel compile test).

- [ ] **Step 5: See it** — start the sandbox server (`PORT=8799 DATA_DIR=<scratch>/ui-data SCHEDULER=off node --import tsx src/index.ts`), import or pick a saved digest in Output, screenshot expanded, one section collapsed, and after Collapse all; check headers, counts and chevrons look like the rest of the app. Stop the sandbox afterwards.

---

### Task 6: Docs, full verification, hand over for Zion's check

**Files:**
- Modify: `README.md`, `CHANGES_FROM_N8N.md`, `HANDOFF.md` (untracked)

- [ ] **Step 1: README** — in "What each tab does", Output row: add "Each topic folds open and shut (*Collapse all / Expand all*)." In the Schedule row add: "The catch-up range also sets how much goes in: more stories per source and per topic for longer ranges (12 h: 8 per source, 25 per topic … 1 month: 50 and 80)." Under the `.env` settings section add `LLM_ITEMS_PER_CALL` ("more stories than this → one AI call per topic, default 150").

- [ ] **Step 2: CHANGES_FROM_N8N.md** — add rows:

```
| Per-source cap | always 8, applied before the time window | grows with the catch-up range (8 → 50) and counts only stories inside it (`src/pipeline/ingest/limits.ts`) | Your request: a 1-week digest only saw each busy site's last few hours |
| Per-topic limit | none | grows with the range (25 → 80); keeps the stories the most outlets covered, then the newest; Custom Feeds exempt | Your request |
| Big digests | one AI call for everything | more than `LLM_ITEMS_PER_CALL` (150) stories → one call per topic, 3 at a time, stitched in section order; a failed topic is listed plainly with a note (`src/pipeline/split.ts`, `write.ts`) | Bug: 562 stories hit Gemini's output limit and looped (2026-10-15) |
| Repeated bullets | kept | removed (tags/spacing ignored) | Bug: a looping answer repeated two bullets ~70× |
| Retry wait when an AI is overloaded | flat 5 s | 5 s, 15 s, 45 s, then 2 min | All 5 tries fell inside one demand spike (2026-10-16) |
```

- [ ] **Step 3: Full verification** — `npm run typecheck && npx vitest run` → clean, all pass. Record the counts.

- [ ] **Step 4: HANDOFF.md** — replace "Next up: split big digests…" with what was built, and note it awaits Zion's check before commit.

- [ ] **Step 5: Hand over** — tell Zion it's ready for his check: what to open (Output tab collapsible topics; a manual run with his current settings to see per-topic progress on hover), what changed, and that nothing is committed yet.
