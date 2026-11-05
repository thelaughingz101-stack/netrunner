import { beforeEach, describe, expect, it } from 'vitest';
import { setEnvForTests } from '../src/env.js';
import { normalizeConfig } from '../src/config/schema.js';
import { log } from '../src/logger.js';
import { AllTiersFailedError, dropRunaways, generate, llmTimeoutFor, retryDelay, tierOrder } from '../src/pipeline/llm/engine.js';
import { attemptStage } from '../src/pipeline/llm/explain.js';
import { LLMError, type LLMRequest, type Provider, type ProviderOutput, type Tier } from '../src/pipeline/llm/types.js';
import { geminiProvider } from '../src/pipeline/llm/gemini.js';
import { claudeProvider } from '../src/pipeline/llm/claude.js';
import { ollamaProvider } from '../src/pipeline/llm/ollama.js';

const req: LLMRequest = {
  kind: 'digest',
  prompt: {
    mode: 'morning', system: 'SYS', user: 'USER',
    geminiBody: { systemInstruction: { parts: [{ text: 'SYS' }] }, contents: [{ role: 'user', parts: [{ text: 'USER' }] }], generationConfig: {} },
  },
};
const ok = (text: string, extra: Partial<ProviderOutput> = {}): ProviderOutput => ({ text, finishReason: 'STOP', truncated: false, model: 'm', ...extra });

/** Scripted provider: each call consumes the next step (a result, or an error to throw). */
function scripted(tier: Tier, steps: (ProviderOutput | LLMError)[], unavailable: string | null = null) {
  const calls: number[] = [];
  const p: Provider = {
    tier,
    unavailable: () => unavailable,
    async call() {
      calls.push(Date.now());
      const s = steps.shift();
      if (!s) throw new LLMError('script exhausted', false);
      if (s instanceof LLMError) throw s;
      return s;
    },
  };
  return { p, calls };
}

const noSleep = { sleep: async () => {}, tries: 3, retryDelayMs: 0, timeoutMs: 1000 };
const cfg = (primary: Tier, fallbackChain: Tier[]) => normalizeConfig({ llm: { primary, fallbackChain } });

// The real loop from 2026-10-16's Comics call: a made-up Facebook link that turned into ~35,000 "2"s, which
// Gemini returned in 8,192-character parts (joined with newlines), so it filled pages of the digest.
const KEPT = ['## 📚 Comics', '**DC Comics**', '*   [**Lobo #8**](https://comicquest.com/new-comics-releases-oct-21-26/) — The Main Man returns in Lobo #8.'];
const LOOP = [...KEPT, `*   [**New Titans #40**](https://www.facebook.com/ComicList/posts/pfbid0${'2'.repeat(4108)}`, '2'.repeat(8192), '2'.repeat(6934),
  '*   [**Nightwing #143**](https://x.dev/n) — Issue #143.'].join('\n');
const LOOP_CLEANED = [...KEPT, '*   [**Nightwing #143**](https://x.dev/n) — Issue #143.'].join('\n');

describe('an AI stuck repeating itself', () => {
  it('drops the lines it filled with a repeated run (even across several lines)', () => {
    expect(dropRunaways(LOOP)).toEqual({ text: LOOP_CLEANED, dropped: 3 });
    expect(dropRunaways(`- ${'ha'.repeat(150)}`).dropped).toBe(1);
  });

  it('leaves ordinary text alone, long lines and short repeats included', () => {
    const fine = ['---', '==========', '| --- | --- | --- |', 'Wow!!!!!!!!!!', '- [**Absolute Batman #25**](https://x.dev/ab25) — 750,000 orders… *(Bleeding Cool)*',
      Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ')].join('\n');
    expect(dropRunaways(fine)).toEqual({ text: fine, dropped: 0 });
  });
});

describe('LLM fallback chain', () => {
  beforeEach(() => setEnvForTests({}));

  it('uses the primary when it answers', async () => {
    const g = scripted('gemini', [ok('from gemini')]);
    const c = scripted('claude', [ok('from claude')]);
    const r = await generate(req, cfg('gemini', ['claude', 'ollama']), log, { ...noSleep, providers: { gemini: g.p, claude: c.p } });
    expect(r).toMatchObject({ tier: 'gemini', text: 'from gemini' });
    expect(c.calls).toHaveLength(0);
  });

  it('retries retryable errors on the same tier before falling back', async () => {
    const g = scripted('gemini', [new LLMError('429', true, 429), new LLMError('503', true, 503), ok('third time')]);
    const r = await generate(req, cfg('gemini', ['claude']), log, { ...noSleep, providers: { gemini: g.p } });
    expect(r.tier).toBe('gemini');
    expect(g.calls).toHaveLength(3);
    expect(r.attempts.map(a => a.ok)).toEqual([false, false, true]);
  });

  it('reports a timeout as a timeout and moves to the next tier instead of re-running the same slow call', async () => {
    const calls: number[] = [];
    // Like gemini.ts: the provider wraps the abort in its own error message.
    const slow: Provider = {
      tier: 'gemini',
      unavailable: () => null,
      call: (_req, signal) => new Promise((_, reject) => {
        calls.push(1);
        signal.addEventListener('abort', () => reject(new LLMError('gemini network error: The operation was aborted due to timeout', true)));
      }),
    };
    const c = scripted('claude', [ok('from claude')]);
    const r = await generate(req, cfg('gemini', ['claude']), log, { ...noSleep, timeoutMs: 20, providers: { gemini: slow, claude: c.p } });
    expect(r.tier).toBe('claude');
    expect(calls).toHaveLength(1);
    expect(r.attempts[0]).toMatchObject({ tier: 'gemini', ok: false, error: expect.stringMatching(/timed out after 0\.?\d* ?s|timed out after/) });
    expect(r.attempts[0].error).toContain('LLM_TIMEOUT_MS');
  });

  it('falls straight to the next tier on a non-retryable error', async () => {
    const g = scripted('gemini', [new LLMError('400 bad request', false, 400)]);
    const c = scripted('claude', [ok('claude saved it')]);
    const r = await generate(req, cfg('gemini', ['claude', 'ollama']), log, { ...noSleep, providers: { gemini: g.p, claude: c.p } });
    expect(g.calls).toHaveLength(1);
    expect(r).toMatchObject({ tier: 'claude', text: 'claude saved it' });
  });

  it('falls through Gemini → Claude → Ollama when the first two exhaust their retries', async () => {
    const g = scripted('gemini', Array(3).fill(new LLMError('500', true, 500)));
    const c = scripted('claude', Array(3).fill(new LLMError('529 overloaded', true, 529)));
    const o = scripted('ollama', [ok('local')]);
    const r = await generate(req, cfg('gemini', ['claude', 'ollama']), log, { ...noSleep, providers: { gemini: g.p, claude: c.p, ollama: o.p } });
    expect(r.tier).toBe('ollama');
    expect(r.attempts.filter(a => !a.ok)).toHaveLength(6);
  });

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

  it('reports every attempt as it starts, naming the tier it fell back from (the Run button hover)', async () => {
    const g = scripted('gemini', [new LLMError('500', true, 500), new LLMError('400 bad request', false, 400)]);
    const c = scripted('claude', [ok('fine')]);
    const seen: string[] = [];
    await generate(req, cfg('gemini', ['claude']), log, { ...noSleep, providers: { gemini: g.p, claude: c.p },
      onAttempt: a => seen.push(`${a.kind} ${a.tier}#${a.attempt}${a.fallbackFrom ? ` after ${a.fallbackFrom}` : ''}`) });
    expect(seen).toEqual(['digest gemini#1', 'digest gemini#2', 'digest claude#1 after gemini']);
  });

  it('honors manual routing from config (primary + reordered chain)', async () => {
    const g = scripted('gemini', [ok('g')]);
    const c = scripted('claude', [new LLMError('down', false)]);
    const o = scripted('ollama', [ok('o')]);
    const config = cfg('claude', ['ollama', 'gemini']);
    expect(tierOrder(config)).toEqual(['claude', 'ollama', 'gemini']);
    const r = await generate(req, config, log, { ...noSleep, providers: { gemini: g.p, claude: c.p, ollama: o.p } });
    expect(r.tier).toBe('ollama');
    expect(g.calls).toHaveLength(0);
  });

  it('skips tiers that are not configured (missing key) without calling them', async () => {
    const g = scripted('gemini', [ok('never')], 'GEMINI_API_KEY not set');
    const c = scripted('claude', [ok('claude')]);
    const r = await generate(req, cfg('gemini', ['claude']), log, { ...noSleep, providers: { gemini: g.p, claude: c.p } });
    expect(g.calls).toHaveLength(0);
    expect(r.tier).toBe('claude');
    expect(r.attempts[0]).toMatchObject({ tier: 'gemini', skipped: 'GEMINI_API_KEY not set' });
  });

  it('prefers a later complete answer over an earlier truncated one', async () => {
    const g = scripted('gemini', [ok('partial', { truncated: true, finishReason: 'MAX_TOKENS' })]);
    const c = scripted('claude', [ok('complete')]);
    const r = await generate(req, cfg('gemini', ['claude']), log, { ...noSleep, providers: { gemini: g.p, claude: c.p } });
    expect(r).toMatchObject({ tier: 'claude', text: 'complete', truncated: false });
  });

  it('ships the truncated answer with the n8n warning banner if nothing better comes', async () => {
    const g = scripted('gemini', [ok('partial', { truncated: true, finishReason: 'MAX_TOKENS' })]);
    const c = scripted('claude', [new LLMError('no', false)]);
    const r = await generate(req, cfg('gemini', ['claude']), log, { ...noSleep, providers: { gemini: g.p, claude: c.p } });
    expect(r.truncated).toBe(true);
    expect(r.text).toBe('⚠️ Gemini response was truncated (hit MAX_TOKENS) before finishing. Raw partial output below:\n\npartial');
  });

  it('throws AllTiersFailedError carrying every attempt when everything fails', async () => {
    const g = scripted('gemini', [new LLMError('x', false)]);
    const c = scripted('claude', [], 'ANTHROPIC_API_KEY not set');
    const o = scripted('ollama', [new LLMError('ECONNREFUSED', false)]);
    await expect(generate(req, cfg('gemini', ['claude', 'ollama']), log, { ...noSleep, providers: { gemini: g.p, claude: c.p, ollama: o.p } }))
      .rejects.toSatisfy((e: unknown) => e instanceof AllTiersFailedError && e.attempts.length === 3);
  });

  it('asks again when the AI gets stuck repeating itself, and the Run button says why', async () => {
    const g = scripted('gemini', [ok(LOOP), ok('clean')]);
    const stages: string[] = [];
    const r = await generate(req, cfg('gemini', []), log, { ...noSleep, providers: { gemini: g.p }, onAttempt: a => stages.push(attemptStage(a)) });
    expect(r).toMatchObject({ tier: 'gemini', text: 'clean', truncated: false });
    expect(r.attempts[0]).toMatchObject({ ok: false, error: expect.stringMatching(/repeating itself/) });
    expect(stages[1]).toBe('Gemini got stuck repeating itself, so trying again (attempt 2 of 3)');
  });

  it('asks again only once, then the next AI; with nothing better it ships the answer minus the broken lines', async () => {
    const g = scripted('gemini', [ok(LOOP), ok(LOOP), ok('never asked')]);
    const c = scripted('claude', [ok('from claude')]);
    expect(await generate(req, cfg('gemini', ['claude']), log, { ...noSleep, providers: { gemini: g.p, claude: c.p } })).toMatchObject({ tier: 'claude', text: 'from claude' });
    expect(g.calls).toHaveLength(2);

    const g2 = scripted('gemini', [ok(LOOP), ok(LOOP)]);
    const c2 = scripted('claude', [new LLMError('no', false)]);
    const r = await generate(req, cfg('gemini', ['claude']), log, { ...noSleep, providers: { gemini: g2.p, claude: c2.p } });
    expect(r).toMatchObject({ tier: 'gemini', text: LOOP_CLEANED, truncated: false });
  });

  it('treats a thrown timeout as retryable', async () => {
    const timeout = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    let n = 0;
    const g: Provider = { tier: 'gemini', unavailable: () => null, call: async () => { if (n++ === 0) throw timeout; return ok('after timeout'); } };
    const r = await generate(req, cfg('gemini', []), log, { ...noSleep, providers: { gemini: g } });
    expect(r.attempts[0].error).toMatch(/timed out/);
    expect(r.text).toBe('after timeout');
  });
});

describe('providers', () => {
  beforeEach(() => setEnvForTests({ GEMINI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' }));
  const signal = new AbortController().signal;

  it('gemini: drops thought parts, flags MAX_TOKENS, classifies HTTP errors', async () => {
    const body = { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'thinking…', thought: true }, { text: '## Digest' }] } }] };
    const p = geminiProvider((async () => new Response(JSON.stringify(body))) as unknown as typeof fetch);
    expect(await p.call(req, signal)).toMatchObject({ text: '## Digest', truncated: true });
    const e429 = geminiProvider((async () => new Response('slow down', { status: 429 })) as unknown as typeof fetch);
    await expect(e429.call(req, signal)).rejects.toMatchObject({ retryable: true, status: 429 });
    const e400 = geminiProvider((async () => new Response('bad', { status: 400 })) as unknown as typeof fetch);
    await expect(e400.call(req, signal)).rejects.toMatchObject({ retryable: false });
  });

  it('claude: resumes pause_turn, joins citation-split text blocks, rejects refusals', async () => {
    const replies = [
      { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's', name: 'web_search', input: {} }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '## Digest\n- Item one ' }, { type: 'text', text: 'continues here.' }] },
    ];
    const seen: any[] = [];
    const fake = { messages: { stream: (params: any) => { seen.push(structuredClone(params)); return { finalMessage: async () => replies.shift() }; } } };
    const p = claudeProvider(() => fake as any);
    const out = await p.call(req, signal);
    expect(out.text).toBe('## Digest\n- Item one continues here.');
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ system: 'SYS', tools: [{ type: 'web_search_20250305', max_uses: 8 }] });
    expect(seen[1].messages).toHaveLength(2); // user + paused assistant turn

    const refusing = { messages: { stream: () => ({ finalMessage: async () => ({ stop_reason: 'refusal', stop_details: { category: 'bio' }, content: [] }) }) } };
    await expect(claudeProvider(() => refusing as any).call(req, signal)).rejects.toMatchObject({ retryable: false });
  });

  describe('ollama', () => {
    const story = { mode: 'morning', id: 'N001', category: 'Gaming', source: 'PC Gamer', title: 'Valve teases a Steam surprise', link: 'https://x.dev/v', published: null,
      summary: 'The Half-Life studio has a surprise for Steam users this week. It involves your library, the company said in a post on Tuesday.' };
    const fake = (answer: string, show: Response | (() => Response) = () => new Response(JSON.stringify({ model_info: { 'llama.context_length': 8192 }, capabilities: ['completion'] }))) => {
      const sent: { url: string; body: any }[] = [];
      const f = (async (url: string, init: any) => {
        sent.push({ url, body: JSON.parse(init.body) });
        if (url.endsWith('/api/show')) return typeof show === 'function' ? show() : show;
        return new Response(JSON.stringify({ message: { content: answer } }));
      }) as unknown as typeof fetch;
      return { f, sent };
    };
    beforeEach(() => setEnvForTests({ OLLAMA_URL: 'http://ollama.test', OLLAMA_MODEL: 'tiny:1b' }));

    it('writes the stories itself, one request each, and says it wrote them on this computer', async () => {
      const { f, sent } = fake('Valve says Steam users will get a surprise this week that involves their library.');
      const config = normalizeConfig({ llm: { primary: 'ollama', fallbackChain: ['gemini'] }, format: { summaryLength: '1' } });
      const out = await ollamaProvider(f).call({ ...req, stories: { items: [story], config } }, signal);
      expect(sent.map(s => s.url)).toEqual(['http://ollama.test/api/show', 'http://ollama.test/api/chat']);
      expect(sent[1].body).toMatchObject({ model: 'tiny:1b', stream: false, options: { num_ctx: 4096, temperature: 0.1, num_predict: 70 } });
      expect(sent[1].body).not.toHaveProperty('think');
      expect(out.text.split('\n')[0]).toBe('🖥️ Written on this computer by tiny:1b, from your feeds only.');
      expect(out.text).toContain('## 🎮 Gaming\n- [**Valve teases a Steam surprise**](https://x.dev/v) — Valve says Steam users will get a surprise this week that involves their library. *(PC Gamer)* [#N001]');
      expect(out.local).toMatchObject({ model: 'tiny:1b', stories: 1, summarized: 1 });
    });

    it('as a backup it says so, and a missed-stories request gets only their sections', async () => {
      const config = normalizeConfig({ llm: { primary: 'gemini', fallbackChain: ['ollama'] } });
      const backup = await ollamaProvider(fake('Valve has a surprise for Steam users this week.').f).call({ ...req, stories: { items: [story], config } }, signal);
      expect(backup.text.split('\n')[0]).toMatch(/^⚠️ Backup digest: the online AIs couldn't write this, so tiny:1b wrote it/);
      const recovery = await ollamaProvider(fake('Valve has a surprise for Steam users this week.').f).call({ ...req, kind: 'recovery', stories: { items: [story], config } }, signal);
      expect(recovery.text.startsWith('## 🎮 Gaming\n')).toBe(true);
      expect(recovery.text).not.toContain('EXCLUDED');
    });

    it("tells the chain when it can't help: not running, model not downloaded, a request too long to read", async () => {
      const down = (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }) as unknown as typeof fetch;
      await expect(ollamaProvider(down).call({ ...req, stories: { items: [story], config: normalizeConfig({}) } }, signal))
        .rejects.toMatchObject({ retryable: false, message: expect.stringContaining('ECONNREFUSED') });
      await expect(ollamaProvider(fake('x', () => new Response('{"error":"model not found"}', { status: 404 })).f).call(req, signal))
        .rejects.toMatchObject({ retryable: false, status: 404, message: 'ollama model "tiny:1b" isn\'t downloaded' });
      const huge = { ...req, kind: 'rollup' as const, prompt: { ...req.prompt, user: 'x'.repeat(40_000) } };
      await expect(ollamaProvider(fake('x').f).call(huge, signal)).rejects.toMatchObject({ retryable: false, message: expect.stringMatching(/^too long for tiny:1b/) });
    });

    it('a thinking model is told not to think', async () => {
      const { f, sent } = fake('Valve has a surprise for Steam users this week.', () => new Response(JSON.stringify({ capabilities: ['completion', 'thinking'] })));
      await ollamaProvider(f).call({ ...req, stories: { items: [story], config: normalizeConfig({ format: { summaryLength: '1' } }) } }, signal);
      expect(sent[1].body.think).toBe(false);
    });
  });
});

describe('an AI that takes one request at a time (Ollama)', () => {
  it('runs attempts one after another, and time spent waiting its turn is not counted against an attempt', async () => {
    let busy = 0, most = 0;
    const order: string[] = [];
    let queue = Promise.resolve();
    const slow: Provider = {
      tier: 'ollama', unavailable: () => null,
      slot: () => { let release!: () => void; const mine = new Promise<void>(r => { release = r; }); const turn = queue.then(() => release); queue = queue.then(() => mine); return turn; },
      timeoutMs: () => 400,
      async call(r, sig) {
        busy++; most = Math.max(most, busy);
        await new Promise(res => setTimeout(res, 150));
        busy--;
        if (sig.aborted) throw new LLMError('aborted', false);
        order.push(r.prompt.user);
        return ok(r.prompt.user);
      },
    };
    const config = cfg('ollama', []);
    const ask = (user: string) => generate({ ...req, prompt: { ...req.prompt, user } }, config, log, { ...noSleep, timeoutMs: 10, providers: { ollama: slow } });
    const answers = await Promise.all(['a', 'b', 'c', 'd'].map(ask));
    expect(answers.map(a => a.text)).toEqual(['a', 'b', 'c', 'd']);
    expect(most).toBe(1);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('LLM timeout scales with the source count', () => {
  const e = { LLM_TIMEOUT_MS: 600_000, LLM_TIMEOUT_PER_SOURCE_MS: 4_000, LLM_TIMEOUT_MAX_MS: 1_800_000 };

  it('never goes below LLM_TIMEOUT_MS', () => {
    expect(llmTimeoutFor(0, e)).toBe(600_000);
    expect(llmTimeoutFor(50, e)).toBe(600_000);
  });

  it('grows per source (custom feeds count too) above the floor', () => {
    expect(llmTimeoutFor(162, e)).toBe(648_000);
    expect(llmTimeoutFor(300, e)).toBe(1_200_000);
  });

  it('is capped at LLM_TIMEOUT_MAX_MS', () => {
    expect(llmTimeoutFor(5_000, e)).toBe(1_800_000);
  });
});
