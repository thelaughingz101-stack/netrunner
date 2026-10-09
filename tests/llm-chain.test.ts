import { beforeEach, describe, expect, it } from 'vitest';
import { setEnvForTests } from '../src/env.js';
import { normalizeConfig } from '../src/config/schema.js';
import { log } from '../src/logger.js';
import { AllTiersFailedError, generate, tierOrder } from '../src/pipeline/llm/engine.js';
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

  it('ollama: uses the RSS-only prompt for digests and adds the fallback banner', async () => {
    let sent: any;
    const p = ollamaProvider((async (_u: string, init: any) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ response: '## Gaming', done_reason: 'stop' })); }) as unknown as typeof fetch);
    const out = await p.call(req, signal);
    expect(sent.prompt).toContain('You have NO internet access');
    expect(sent.prompt.endsWith('RSS ITEMS:\nUSER')).toBe(true);
    expect(out.text).toBe('⚠️ FALLBACK DIGEST (Gemini unavailable — RSS only)\n\n## Gaming');
  });
});
