import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '../src/config/schema.js';
import { buildLlmPayload, buildManualPrompt } from '../src/pipeline/prompt/index.js';
import type { Item } from '../src/pipeline/types.js';

const items: Item[] = [
  { mode: 'morning', source: 'IGN', category: 'Gaming', title: 'GTA 6 trailer', link: 'https://ign.com/gta', published: '2026-10-08T10:00:00Z', summary: 's' },
];
const config = normalizeConfig({ topics: { Comics: false } });
const deployed = (f: string) => fs.readFileSync(path.resolve(__dirname, '../../n8n-export/nodes', f), 'utf8').replace(/\r\n/g, '\n');

describe('Build LLM Payload (verbatim n8n code under the shim)', () => {
  const p = buildLlmPayload({ mode: 'morning', items, morningDigest: '' }, config, []);

  it('produces the Gemini body n8n sent', () => {
    expect(p.geminiBody.generationConfig).toEqual({ maxOutputTokens: 65536, thinkingConfig: { thinkingBudget: 8192, includeThoughts: false }, temperature: 0.1, topP: 0.9 });
    expect(p.geminiBody.tools).toEqual([{ googleSearch: {} }]);
    expect(p.system.startsWith('You are a MORNING news digest agent.')).toBe(true);
    expect(p.user).toContain('PRE-FETCHED FEED ITEMS (JSON) — 1 items, this is the CLOSED FEED SET:');
    expect(p.user).toContain(JSON.stringify(items));
  });

  it('keeps the prompt text verbatim apart from the two flagged patches', () => {
    // A long, distinctive verbatim line from the deployed node:
    expect(p.system).toContain('This section is REQUIRED even when empty — it is usually generated last and the first thing a length limit would eat');
    expect(p.system).toContain('- NEVER invent, extrapolate, or assume. Unknown = excluded (with a reason), never invented.\n- FILLER REJECTION:');
    expect(p.system).toContain('reason: duplicate | stale | unverified | spam | filler');
    expect(p.system).toContain('ONLY the five reasons above are valid');
    expect(p.system).not.toContain('filler..');
  });

  it('respects topic toggles and section order', () => {
    expect(p.system).not.toContain('## 📚 Comics');
    expect(p.system).toContain('## 🗒️ EXCLUDED');
  });

  it('now receives developing stories on nightly runs (always empty in n8n)', () => {
    const n = buildLlmPayload({ mode: 'nightly', items, morningDigest: '# morning' }, config, ['- "GTA 6" (seen 3 days, first: 2026-10-06)']);
    expect(n.user).toContain('DEVELOPING STORIES (seen 3+ days this week — check for updates):\n- "GTA 6"');
    expect(n.user).toContain('PRIOR MORNING DIGEST (today):\n# morning');
  });
});

describe('Manual-mode exporters', () => {
  for (const platform of ['chatgpt', 'claude', 'gemini', 'grok', 'deepseek'] as const) {
    it(`${platform}: returns the split-copy parts with mode manual-${platform}`, () => {
      const out = buildManualPrompt({ mode: 'morning', items, morningDigest: '' }, normalizeConfig({ delivery: { chatbotPlatform: platform } }), '2026-10-08');
      expect(out.mode).toBe(`manual-${platform}`);
      expect(out.digest).toContain('SYSTEM INSTRUCTIONS');
      expect(out.systemInstructions.length).toBeGreaterThan(2000);
      expect(out.userRequest).toContain('GTA 6 trailer | IGN | https://ign.com/gta');
      expect(out.howToUse).toMatch(/HOW TO USE/);
    });
  }

  it('gemini: the escaped ${mode} bug is fixed', () => {
    const out = buildManualPrompt({ mode: 'nightly', items, morningDigest: '' }, normalizeConfig({ delivery: { chatbotPlatform: 'gemini' } }), '2026-10-08');
    expect(out.systemInstructions).not.toContain("${mode");
    // (The Business & Finance rule is never emitted by this exporter — B&F isn't in its TOPIC_EMOJI —
    //  so only the US Politics half of the fix is visible in the output.)
    expect(out.systemInstructions).toContain('Politico. Developments since this morning.');
  });

  it('chatgpt export is the deployed node verbatim apart from the summary-length patch', () => {
    const gen = fs.readFileSync(path.resolve(__dirname, '../src/pipeline/prompt/generated/exportChatgpt.ts'), 'utf8');
    const original = deployed('digest_export__ChatGPT_.js');
    expect(gen).toContain(original.slice(0, original.indexOf("const TZ = 'America/New_York';")));
    expect(gen).toContain(original.slice(original.indexOf('SUMMARIES: 2–3 sentences each, no filler.') + 'SUMMARIES: 2–3 sentences each, no filler.'.length));
  });

  for (const platform of ['chatgpt', 'claude', 'gemini', 'grok', 'deepseek'] as const) {
    it(`${platform}: honors Format → Summary length (was hardcoded to 2–3 sentences)`, () => {
      const prompt = (summaryLength: string) => buildManualPrompt({ mode: 'morning', items, morningDigest: '' },
        normalizeConfig({ delivery: { chatbotPlatform: platform }, format: { summaryLength } }), '2026-10-08').systemInstructions;
      expect(prompt('1')).toContain('SUMMARIES: Each item gets exactly 1 sentence');
      expect(prompt('full')).toContain('SUMMARIES: Each item gets a full 3-5 sentence summary');
      expect(prompt('2-3')).toContain('SUMMARIES: Each item gets a 2-3 sentence summary');
      expect(prompt('1')).not.toContain('2–3 sentences each');
    });
  }

  it('falls back to the ChatGPT exporter for retired platforms (n8n Switch fallback)', () => {
    const out = buildManualPrompt({ mode: 'morning', items, morningDigest: '' }, normalizeConfig({ delivery: { chatbotPlatform: 'notebooklm' } }), '2026-10-08');
    expect(out.digest).toMatch(/CHATGPT DIGEST PROMPT/i);
  });
});

describe('Topic toggles reach every prompt (n8n ignored them in places)', () => {
  const TOPICS_ALL = ['Gaming', 'TV & Movies', 'Media Announcements', 'Anime', 'Animation', 'Tech & Hardware', 'AI & LLMs', 'US Politics', 'World News', 'Business & Finance', 'Science & Space', 'Security', 'Comics', 'Notable Trends', 'Blindspot Analysis', 'Leaks & Rumors', 'Custom Feeds'];
  const only = (...on: string[]) => normalizeConfig({ topics: Object.fromEntries(TOPICS_ALL.map(t => [t, on.includes(t)])) });
  const leaksOnly = only('Leaks & Rumors');

  for (const mode of ['morning', 'nightly'] as const) {
    it(`AI Writer (${mode}), only Leaks on: searches only for leaks, headers only Leaks/Everything Else/EXCLUDED`, () => {
      const p = buildLlmPayload({ mode, items, morningDigest: '' }, leaksOnly, []);
      expect(p.user).toContain('- Gaming leaks and rumors ONLY from journalists');
      for (const gone of ['trending X/Twitter', 'S&P 500', 'comic book releases', 'Science and space', 'Anime news', 'Cybersecurity', 'OFFICIALLY announced', 'Blindspot']) expect(p.user).not.toContain(gone);
      const headers = p.system.slice(p.system.indexOf('REQUIRED HEADER ORDER')).split('\n').filter(l => l.startsWith('## '));
      expect(headers).toEqual([...(mode === 'nightly' ? ['## 🔄 Story Updates'] : []), '## 🕵️ Leaks & Rumors', '## 📋 Everything Else', '## 🗒️ EXCLUDED']);
      expect(p.system).not.toContain('## 👁️ Blindspot Analysis, ## 🕵️ Leaks & Rumors, and');
      expect(p.system).toContain('never in 📋 Everything Else');
    });

    it(`AI Writer (${mode}), everything on: same search list n8n sent`, () => {
      const p = buildLlmPayload({ mode, items, morningDigest: '' }, normalizeConfig({}), []);
      const original = deployed('Build LLM Payload.js');
      const marker = mode === 'nightly' ? "Produce tonight's digest" : "Produce this morning's digest";
      const block = original.slice(original.indexOf('Also search for', original.indexOf(marker)), original.indexOf('that other major outlets are ignoring', original.indexOf(marker))).split('\\n').slice(1);
      expect(block.length).toBe(11);
      for (const line of block) expect(p.user).toContain(line);
    });
  }

  it('AI Writer: no topics needing search → tells the model not to search', () => {
    expect(buildLlmPayload({ mode: 'morning', items, morningDigest: '' }, only('Tech & Hardware'), []).user).toContain('No live searches are needed');
  });

  for (const platform of ['chatgpt', 'claude', 'gemini', 'grok', 'deepseek'] as const) {
    it(`${platform} exporter follows the toggles (no forced B&F / Blindspot / double Leaks)`, () => {
      const cfg = (c: ReturnType<typeof normalizeConfig>) => normalizeConfig({ ...c, delivery: { ...c.delivery, chatbotPlatform: platform } });
      const sys = buildManualPrompt({ mode: 'morning', items, morningDigest: '' }, cfg(leaksOnly), '2026-10-08').systemInstructions;
      const headers = sys.split('\n').filter(l => /^## /.test(l));
      expect(headers).toEqual(['## 🕵️ Leaks & Rumors', '## 📋 Everything Else', '## 🗒️ EXCLUDED']);
      expect(sys).not.toContain('- 💼 Business & Finance');
      expect(sys).not.toContain('- 👁️ Blindspot');

      const all = buildManualPrompt({ mode: 'morning', items, morningDigest: '' }, cfg(normalizeConfig({})), '2026-10-08').systemInstructions;
      const allHeaders = all.split('\n').filter(l => /^## /.test(l));
      expect(allHeaders.filter(h => h.includes('Leaks'))).toHaveLength(1);
      for (const t of ['💼 Business & Finance', '🌍 World News', '👁️ Blindspot Analysis']) expect(allHeaders).toContain(`## ${t}`);
    });
  }
});
