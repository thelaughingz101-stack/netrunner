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

  it('puts topics in the configured section order, not call order (search-only topics come last as calls)', () => {
    const gaming = '## 🎮 Gaming\n- [**G1**](u) [#N001]\n## 📋 Everything Else\n_Nothing._';
    const custom = '## 📡 Custom Feeds\n- [**C1**](u) [#N002]';
    const searches = '## 👁️ Blindspot Analysis\n- [**B1**](u)\n## 🕵️ Leaks & Rumors\n- [**L1**](u)';
    const order = ['Gaming', 'Blindspot Analysis', 'Leaks & Rumors', 'Custom Feeds'];
    expect(stitch([gaming, custom, searches], order).split('\n').filter(l => l.startsWith('## ')))
      .toEqual(['## 🎮 Gaming', '## 👁️ Blindspot Analysis', '## 🕵️ Leaks & Rumors', '## 📡 Custom Feeds', '## 📋 Everything Else']);
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

  it('keeps repeated boilerplate lines that belong in several places (Comics publishers with no releases)', () => {
    const comics = ['## 📚 Comics', '### Image', '- No confirmed releases found for this week.', '### Boom', '- No confirmed releases found for this week.', '### Dark Horse', '- No confirmed releases found for this week.'].join('\n');
    expect(dedupeBullets(comics)).toEqual({ md: comics, removed: 0 });
  });

  it('removes bullets an AI repeated word for word (tags and spacing ignored)', () => {
    const loop = ['## 🏛️ US Politics', '- [**A**](u) — a. *(BBC)* [#N001]', '- [**B**](u) — b. *(BBC)*', '- [**A**](u)  —  a. *(BBC)* [#N007]', '- [**B**](u) — b. *(BBC)*', 'Plain line', 'Plain line'];
    expect(dedupeBullets(loop.join('\n'))).toEqual({ md: ['## 🏛️ US Politics', '- [**A**](u) — a. *(BBC)* [#N001]', '- [**B**](u) — b. *(BBC)*', 'Plain line', 'Plain line'].join('\n'), removed: 2 });
  });
});
