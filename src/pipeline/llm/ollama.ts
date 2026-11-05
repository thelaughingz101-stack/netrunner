// The local tier: a model running in Ollama on this computer (or wherever OLLAMA_URL points). Built for small
// models, 1.7B parameters and up, wherever Ollama sits in the chain: digests and missed-story requests carry
// their stories (LLMRequest.stories) and local.ts writes them one at a time. n8n's version (disabled there) sent
// the whole feed with a short "RSS-only" prompt listing five sections; a 1.7B model can't read that much.
import { env } from '../../env.js';
import { llmFetch, networkDetail } from './http.js';
import { feedlessTopics, writeLocally, type Chat, type ChatMessage, type LocalStats } from './local.js';
import { LLMError, type LLMRequest, type Provider } from './types.js';

/** Context asked for on a request that isn't stories: no more than this, so an 8 GB laptop isn't swamped. */
const MAX_CONTEXT = 8192;
/** Story requests are short (≈400 tokens with the examples); the same size every time, so the model stays loaded. */
const STORY_CONTEXT = 4096;
/** A story's request may take this long (a slow PC, a big model) before that story keeps its feed text. */
const PER_STORY_MS = 120_000;
/** The whole job's allowance per story the model is asked about, on top of loading the model. */
const JOB_MS_PER_STORY = 45_000;
const JOB_BASE_MS = 120_000;

export interface ModelInfo { contextLength: number | null; capabilities: string[] }

const baseUrl = () => env().OLLAMA_URL.replace(/\/$/, '');

/**
 * Ollama answers one request at a time on a normal PC; NetRunner writes up to three parts of a big digest at
 * once. The engine waits for this before starting an attempt's clock, so time spent queued isn't counted.
 */
let queue: Promise<void> = Promise.resolve();
export function oneAtATime(): Promise<() => void> {
  let release!: () => void;
  const mine = new Promise<void>(r => { release = r; });
  const turn = queue.then(() => release);
  queue = queue.then(() => mine);
  return turn;
}

async function post(fetchImpl: typeof fetch, path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  try {
    return await fetchImpl(`${baseUrl()}${path}`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (err) {
    if (signal.aborted) throw err;
    const code = (err as Error & { cause?: { code?: string } }).cause?.code;
    // Nothing listening → retrying won't help.
    throw new LLMError(`ollama unreachable at ${env().OLLAMA_URL}: ${code ?? networkDetail(err)}`, code !== 'ECONNREFUSED');
  }
}

/** The model's details; throws when Ollama isn't there or the model isn't downloaded (the chain moves on). */
export async function showModel(fetchImpl: typeof fetch, model: string, signal: AbortSignal): Promise<ModelInfo> {
  const res = await post(fetchImpl, '/api/show', { model }, signal);
  if (res.status === 404) throw new LLMError(`ollama model "${model}" isn't downloaded`, false, 404);
  if (!res.ok) throw new LLMError(`ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status >= 500, res.status);
  const data: any = await res.json();
  const info = data?.model_info ?? {};
  const key = Object.keys(info).find(k => k.endsWith('.context_length'));
  return { contextLength: key ? Number(info[key]) || null : null, capabilities: Array.isArray(data?.capabilities) ? data.capabilities : [] };
}

/** One chat request (non-streaming). Thinking models are told not to think: it's slow and the answer is short. */
export function chatWith(fetchImpl: typeof fetch, model: string, info: ModelInfo, numCtx: number): Chat {
  return async (messages: ChatMessage[], maxTokens: number, signal: AbortSignal) => {
    const res = await post(fetchImpl, '/api/chat', {
      model, messages, stream: false,
      ...(info.capabilities.includes('thinking') ? { think: false } : {}),
      options: { num_ctx: numCtx, temperature: 0.1, num_predict: maxTokens },
    }, signal);
    if (!res.ok) throw new LLMError(`ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status >= 500, res.status);
    const data: any = await res.json();
    const text = String(data?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (!text) throw new LLMError('ollama returned no text', false);
    return text;
  };
}

/** Tokens in a text, roughly (English averages about 4 characters a token; URLs and JSON fewer). */
const tokensIn = (s: string) => Math.ceil(s.length / 3.2);

export function ollamaProvider(fetchImpl: typeof fetch = llmFetch): Provider {
  return {
    tier: 'ollama',
    unavailable: () => (env().OLLAMA_URL ? null : 'OLLAMA_URL not set'),
    slot: oneAtATime,
    // A story job takes as long as the model needs per story; the run's own time limit still applies.
    timeoutMs: (req, base) => (req.stories ? Math.max(base, JOB_BASE_MS + req.stories.items.length * JOB_MS_PER_STORY) : base),
    async call(req: LLMRequest, signal: AbortSignal) {
      const model = env().OLLAMA_MODEL;
      const info = await showModel(fetchImpl, model, signal);
      if (req.stories) {
        const { items, config, onProgress } = req.stories;
        const primary = config.llm.primary === 'ollama';
        const missing = feedlessTopics(items, config);
        const notes = req.kind === 'recovery' ? [] : [
          primary ? `🖥️ Written on this computer by ${model}, from your feeds only.`
            : `⚠️ Backup digest: the online AIs couldn't write this, so ${model} wrote it on this computer, from your feeds only.`,
          ...(missing.length ? [`Nothing from your feeds for ${missing.join(', ')}: Gemini or Claude would search the web for ${missing.length === 1 ? 'it' : 'them'}.`] : []),
        ];
        const { text, stats } = await writeLocally({
          items, config, model, notes, recovery: req.kind === 'recovery', signal, perStoryMs: PER_STORY_MS,
          chat: chatWith(fetchImpl, model, info, Math.min(info.contextLength ?? STORY_CONTEXT, STORY_CONTEXT)),
          onProgress: onProgress && ((done, total) => onProgress(`${model} is summarizing: ${done} of ${total} stories`)),
        });
        return { text, finishReason: stats.stopped ?? 'stop', truncated: false, model, local: stats satisfies LocalStats };
      }
      // A recap or a grade: one request, if it fits what the model can read.
      const context = Math.min(info.contextLength ?? MAX_CONTEXT, MAX_CONTEXT);
      const messages: ChatMessage[] = [{ role: 'system', content: req.prompt.system }, { role: 'user', content: req.prompt.user }];
      const need = tokensIn(req.prompt.system + req.prompt.user);
      if (need > context - 1024) throw new LLMError(`too long for ${model}: about ${need.toLocaleString('en-US')} tokens, it reads ${context.toLocaleString('en-US')}`, false);
      const text = await chatWith(fetchImpl, model, info, context)(messages, 2048, signal);
      return { text, finishReason: 'stop', truncated: false, model };
    },
  };
}
