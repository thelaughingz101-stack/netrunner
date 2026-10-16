import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { freshState } from './helpers.js';
import { saveConfig } from '../src/config/store.js';
import { db } from '../src/db/db.js';
import { DateTime } from 'luxon';
import { findDigest, saveDigest } from '../src/digests.js';
import { run, runPrompt, runStatus } from '../src/pipeline/run.js';
import { getRun } from '../src/pipeline/runs.js';
import { buildApp } from '../src/server/app.js';
import { runRoutes } from '../src/server/routes/run.js';
import { LLMError, type LLMRequest, type Provider } from '../src/pipeline/llm/types.js';
import type { DeliveryTarget } from '../src/pipeline/delivery/types.js';

const fresh = () => new Date(Date.now() - 3600e3).toUTCString();
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>Rockstar reveals Grand Theft Auto trailer date</title><link>https://www.ign.com/gta</link><pubDate>${fresh()}</pubDate><description>GTA news</description></item>
<item><title>Nintendo announces new Zelda remaster for Switch</title><link>https://www.ign.com/zelda</link><pubDate>${fresh()}</pubDate><description>Zelda</description></item>
<item><title>Valve quietly updates Steam Deck firmware</title><link>https://www.ign.com/deck</link><pubDate>${fresh()}</pubDate><description>Deck</description></item>
</channel></rss>`;
const fetchText = async (url: string) => (url.includes('ign.com') ? { status: 200, text: RSS } : { status: 404, text: '' });

/** LLM that "forgets" one item on the first pass, then answers the recovery request. */
function forgetfulLlm() {
  const calls: LLMRequest[] = [];
  const p: Provider = {
    tier: 'gemini', unavailable: () => null,
    async call(req) {
      calls.push(req);
      if (req.kind === 'recovery') {
        const ids = [...req.prompt.user.matchAll(/"id":"(N\d+)"/g)].map(m => m[1]);
        return { text: `## 🎮 Gaming\n${ids.map(id => `- [**Recovered ${id}**](u) — back. *(IGN)* [#${id}]`).join('\n')}`, finishReason: 'STOP', truncated: false, model: 'g' };
      }
      if (req.kind === 'rollup') return { text: '## 📰 WEEK IN REVIEW\n- big week', finishReason: 'STOP', truncated: false, model: 'g' };
      const ids = [...req.prompt.user.matchAll(/"id":"(N\d+)"/g)].map(m => m[1]);
      const kept = ids.slice(0, -1); // drop the last item
      return {
        text: `## 🎮 Gaming\n${kept.map(id => `- [**Story ${id} about Grand Theft Auto trailer**](u) — x. *(IGN)* [#${id}]`).join('\n')}\n## 📋 Everything Else\n_Nothing outside the above sections._\n## 🗒️ EXCLUDED\nEXCLUDED: none`,
        finishReason: 'STOP', truncated: false, model: 'g',
      };
    },
  };
  return { p, calls };
}

function recordingTarget() {
  const sent: string[] = [];
  const t: DeliveryTarget = {
    name: 'discord', enabled: c => c.delivery.discord, misconfigured: () => null,
    render: input => ({ summary: '1 message', preview: { 'x.txt': input.digest }, send: async () => { sent.push(input.digest); return 'ok'; } }),
  };
  return { t, sent };
}

describe('full pipeline (fake feeds + scripted LLM)', () => {
  beforeEach(() => {
    freshState({ GEMINI_API_KEY: 'k', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'nr-e2e-')) });
    saveConfig({
      sources: {}, topics: { Gaming: true },
      llm: { mode: 'llm', primary: 'gemini', fallbackChain: [] },
      delivery: { discord: true },
      rollups: { weekly: true },
    });
  });

  it('morning run: ingest → ids → LLM → recovery of the dropped item → save → tracker → deliver', async () => {
    const llm = forgetfulLlm();
    const target = recordingTarget();
    const out: any = await run({ trigger: 'cli', forceMode: 'morning', fetchText, feedTries: 1, engine: { providers: { gemini: llm.p }, tries: 1 }, targets: [target.t] });

    expect(out.kind).toBe('digest');
    expect(llm.calls.map(c => c.kind)).toEqual(['digest', 'recovery']);
    expect(llm.calls[0].prompt.system).toContain('ITEM IDS (machine-checked');
    expect(llm.calls[1].prompt.user.match(/"id":"N\d+"/g)).toHaveLength(1); // only the dropped one
    expect(out.digest).toContain('Recovered');
    expect(out.digest).not.toMatch(/\[#N\d+\]/);           // tags stripped before delivery
    expect(target.sent).toEqual([out.digest]);
    expect(out.stats.coverage).toMatchObject({ expected: 3, firstPassMissing: 1, forced: 0 });

    const r: any = getRun(out.runId);
    expect(r.status).toBe('ok');
    expect(r.llmTier).toBe('gemini');
    expect(r.items.map((i: any) => i.placement)).toEqual(['section', 'section', 'recovered']);
    expect(r.deliveries).toEqual([expect.objectContaining({ target: 'discord', status: 'sent' })]);
    expect((db().prepare('SELECT COUNT(*) n FROM stories').get() as any).n).toBeGreaterThan(0);
  });

  it('nightly run gets the morning digest from the DB (continuity fixed)', async () => {
    const llm = forgetfulLlm();
    const opts = { trigger: 'cli' as const, fetchText, feedTries: 1, engine: { providers: { gemini: llm.p }, tries: 1 }, targets: [] };
    const morning: any = await run({ ...opts, forceMode: 'morning' });
    await run({ ...opts, forceMode: 'nightly' });
    const nightlyCall = llm.calls.filter(c => c.kind === 'digest')[1];
    expect(nightlyCall.prompt.system.startsWith('You are a NIGHTLY news digest agent.')).toBe(true);
    expect(nightlyCall.prompt.user).toContain(`PRIOR MORNING DIGEST (today):\n${morning.digest}`);
  });

  it('dry run: full pipeline, nothing delivered, tracker untouched, digest flagged', async () => {
    const llm = forgetfulLlm();
    const target = recordingTarget();
    const out: any = await run({ trigger: 'cli', forceMode: 'morning', dryRun: true, fetchText, feedTries: 1, engine: { providers: { gemini: llm.p }, tries: 1 }, targets: [target.t] });
    expect(target.sent).toHaveLength(0);
    expect(out.delivery[0].status).toBe('dry-run');
    expect((db().prepare('SELECT COUNT(*) n FROM stories').get() as any).n).toBe(0);
    expect(findDigest(out.date, 'morning')).toBeUndefined(); // dry-run digests never feed continuity
  });

  it('Manual mode returns the split prompt parts and saves them', async () => {
    const out = await runPrompt({ trigger: 'cli', forceMode: 'morning', fetchText, feedTries: 1 });
    expect(out.mode).toBe('manual-chatgpt');
    expect(out.userRequest).toContain('Rockstar reveals Grand Theft Auto trailer date | IGN | https://www.ign.com/gta');
  });

  it('weekly rollup runs through the same engine and delivery', async () => {
    const llm = forgetfulLlm();
    const target = recordingTarget();
    const out: any = await run({ trigger: 'schedule', forceMode: 'weekly', engine: { providers: { gemini: llm.p }, tries: 1 }, targets: [target.t] });
    expect(out.mode).toBe('weekly');
    expect(llm.calls.map(c => c.kind)).toEqual(['rollup']);
    expect(target.sent[0]).toContain('WEEK IN REVIEW');
  });

  it('a disabled rollup is skipped and logged, not run', async () => {
    saveConfig({ rollups: { weekly: false } });
    const out = await run({ trigger: 'schedule', forceMode: 'weekly' });
    expect(out).toEqual({ kind: 'skipped', reason: 'weekly rollup disabled' });
  });

  it('a run that exhausts every tier is recorded as an error and delivers nothing', async () => {
    const target = recordingTarget();
    const dead: Provider = { tier: 'gemini', unavailable: () => null, call: async () => { throw Object.assign(new Error('boom')); } };
    await expect(run({ trigger: 'cli', forceMode: 'morning', fetchText, feedTries: 1, engine: { providers: { gemini: dead }, tries: 2, retryDelayMs: 0 }, targets: [target.t] }))
      .rejects.toThrow(/No AI could write the digest/);
    const last: any = db().prepare("SELECT status, stats_json FROM runs WHERE kind = 'digest' ORDER BY started_at DESC LIMIT 1").get();
    expect(last.status).toBe('error');
    expect(JSON.parse(last.stats_json).llmAttempts).toHaveLength(2);
    expect(target.sent).toHaveLength(0);
  });

  it('API: POST /api/run returns the digest; a concurrent run gets 409', async () => {
    const app = await buildApp([runRoutes]);
    // No real feeds/LLM over HTTP here — just prove the lock: start one run and immediately start another.
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const slow: Provider = { tier: 'gemini', unavailable: () => null, call: async () => { await gate; return { text: '## x', finishReason: 'STOP', truncated: false, model: 'g' }; } };
    const first = run({ trigger: 'cli', forceMode: 'morning', fetchText, feedTries: 1, engine: { providers: { gemini: slow }, tries: 1 }, targets: [] });
    // Until the first run holds the lock (a fixed 50 ms wasn't always enough with the whole suite running).
    while (!runStatus()) await new Promise(r => setTimeout(r, 10));
    const res = await app.inject({ method: 'POST', url: '/api/run', payload: { dryRun: true } });
    expect(res.statusCode).toBe(409);
    release();
    await first;
    const runs = (await app.inject({ method: 'GET', url: '/api/runs' })).json();
    expect(runs.runs[0]).toMatchObject({ status: 'ok', kind: 'digest' });
  });

  it('says what the run is doing right now (the Run button hover), and clears when it ends', async () => {
    const seen: Record<string, string> = {};
    const sample = (k: string) => { const st = runStatus(); if (st && !(k in seen)) seen[k] = `${st.title}: ${st.stage}`; };
    const llm = forgetfulLlm();
    const provider: Provider = { ...llm.p, call: async (req, signal) => { sample(req.kind); return llm.p.call(req, signal); } };
    const target = recordingTarget();
    const t: DeliveryTarget = { ...target.t, render: (input, ctx) => { const r = target.t.render(input, ctx); return { ...r, send: async () => { sample('deliver'); return r.send(); } }; } };
    const app = await buildApp([runRoutes]);
    await run({ trigger: 'api', forceMode: 'morning', fetchText: async (url: string) => { sample('fetch'); return fetchText(url); }, feedTries: 1, engine: { providers: { gemini: provider }, tries: 1 }, targets: [t] });

    expect(seen.fetch).toMatch(/^Morning digest: Fetching sources \(\d+ of \d+\)$/);
    expect(seen.digest).toBe('Morning digest: Writing the digest with Gemini');
    expect(seen.recovery).toBe('Morning digest: Adding the stories the first draft missed, with Gemini');
    expect(seen.deliver).toBe('Morning digest: Delivering');
    expect(runStatus()).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/api/run/status' })).json()).toEqual({ running: null });
  });
});

describe('big runs: one AI call per topic', () => {
  const VERGE = `<?xml version="1.0"?><rss version="2.0"><channel><title>v</title>
<item><title>Framework unveils modular laptop motherboard</title><link>https://www.theverge.com/framework</link><pubDate>${fresh()}</pubDate><description>a</description></item>
<item><title>Raspberry Pi foundation ships compute module</title><link>https://www.theverge.com/pi</link><pubDate>${fresh()}</pubDate><description>b</description></item>
</channel></rss>`;
  const twoTopics = async (url: string) => url.includes('ign.com') ? { status: 200, text: RSS } : url.includes('theverge.com') ? { status: 200, text: VERGE } : { status: 404, text: '' };

  /** Writes every story it's given under the first topic header of the prompt; throws for prompts matching `failOn`. */
  function topicLlm(failOn?: RegExp, opts: { updates?: boolean } = {}) {
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
        // Nightly: an update for its topic when the call saw the morning digest, else the AI's usual "nothing to update".
        const updates = !opts.updates ? '' : /MORNING/.test(req.prompt.user)
          ? `## 🔄 Story Updates\n- [**Update on ${topic.replace(/^##\s*\S+\s*/, '')}**](u) — changed. *(S)*\n`
          : '## 🔄 Story Updates\nNo prior morning digest was available, so there are no updates.\n';
        return { text: `${updates}${topic}\n${ids.map(id => `- [**Story ${id}**](u) — x. *(S)* [#${id}]`).join('\n')}\n## 📋 Everything Else\n_Nothing outside the above sections._\n## 🗒️ EXCLUDED\nEXCLUDED: none`, finishReason: 'STOP', truncated: false, model: 'g' };
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

  it('nightly: each topic call sees only its part of the morning digest; Story Updates comes only from calls that had one', async () => {
    const today = DateTime.now().setZone('America/New_York').toISODate()!;
    saveDigest({ date: today, mode: 'morning', content: '## 🎮 Gaming\n- [**GAMING-MORNING**](u) — x. *(IGN)*\n## 🖥️ Tech & Hardware\n- [**TECH-MORNING**](u) — y. *(The Verge)*\n## 📋 Everything Else\n- [**ELSE-MORNING**](u) — z. *(S)*' });
    const llm = topicLlm(undefined, { updates: true });
    const out: any = await run({ trigger: 'cli', forceMode: 'nightly', fetchText: twoTopics, feedTries: 1, engine: { providers: { gemini: llm.p }, tries: 1 }, targets: [] });
    const digestCalls = llm.calls.filter(c => c.kind === 'digest');
    const gaming = digestCalls.find(c => /^## 🎮 Gaming$/m.test(c.prompt.system))!;
    const tech = digestCalls.find(c => /^## 🖥️ Tech & Hardware$/m.test(c.prompt.system))!;
    expect(gaming.prompt.user).toContain('GAMING-MORNING');
    expect(gaming.prompt.user).not.toContain('TECH-MORNING');
    expect(tech.prompt.user).toContain('TECH-MORNING');
    expect(tech.prompt.user).not.toContain('GAMING-MORNING');
    const at = out.digest.indexOf('## 🔄 Story Updates');
    const updates = out.digest.slice(at, out.digest.indexOf('\n## ', at + 5));
    expect(updates).toContain('Update on Gaming');
    expect(updates).toContain('Update on Tech & Hardware');
    expect(updates).not.toContain('No prior morning digest');
    expect(out.digest.match(/## 🔄 Story Updates/g)).toHaveLength(1);
  });

  it('if every topic call fails, the run fails with the plain-English reason', async () => {
    const llm = topicLlm(/REQUIRED HEADER ORDER/);
    await expect(run({ trigger: 'cli', forceMode: 'morning', fetchText: twoTopics, feedTries: 1, engine: { providers: { gemini: llm.p }, tries: 1 }, targets: [] }))
      .rejects.toThrow(/No AI could write the digest/);
  });
});
