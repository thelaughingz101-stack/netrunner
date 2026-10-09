import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { freshState } from './helpers.js';
import { saveConfig } from '../src/config/store.js';
import { db } from '../src/db/db.js';
import { findDigest } from '../src/digests.js';
import { run, runPrompt } from '../src/pipeline/run.js';
import { getRun } from '../src/pipeline/runs.js';
import { buildApp } from '../src/server/app.js';
import { runRoutes } from '../src/server/routes/run.js';
import type { LLMRequest, Provider } from '../src/pipeline/llm/types.js';
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
      .rejects.toThrow(/all LLM tiers failed/);
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
    await new Promise(r => setTimeout(r, 50));
    const res = await app.inject({ method: 'POST', url: '/api/run', payload: { dryRun: true } });
    expect(res.statusCode).toBe(409);
    release();
    await first;
    const runs = (await app.inject({ method: 'GET', url: '/api/runs' })).json();
    expect(runs.runs[0]).toMatchObject({ status: 'ok', kind: 'digest' });
  });
});
