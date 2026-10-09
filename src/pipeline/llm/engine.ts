// Three-tier fallback chain behind one interface. Order = config.llm.primary + fallbackChain
// (the UI's AI Engine tab — finally honored; n8n's canvas was hardwired Gemini → Claude).
import { env } from '../../env.js';
import type { Config } from '../../config/schema.js';
import type { Logger } from '../../logger.js';
import { claudeProvider } from './claude.js';
import { geminiProvider } from './gemini.js';
import { ollamaProvider } from './ollama.js';
import { LLMError, type AttemptLog, type LLMRequest, type LLMResult, type Provider, type ProviderOutput, type Tier } from './types.js';

export { LLMError };
export type { LLMRequest, LLMResult, Provider, Tier };

export interface EngineOptions {
  providers?: Partial<Record<Tier, Provider>>;
  tries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class AllTiersFailedError extends Error {
  statusCode = 502; // upstream (LLM) failure, surfaced as-is to the UI
  constructor(public attempts: AttemptLog[]) {
    super(`all LLM tiers failed: ${attempts.filter(a => !a.ok).map(a => `${a.tier}#${a.attempt} ${a.skipped ?? a.error}`).join(' | ')}`);
    this.name = 'AllTiersFailedError';
  }
}

export const tierOrder = (config: Config): Tier[] => [...new Set([config.llm.primary, ...config.llm.fallbackChain])] as Tier[];

const truncationBanner = (tier: Tier, text: string) =>
  `⚠️ ${tier === 'gemini' ? 'Gemini' : tier === 'claude' ? 'Claude' : 'Ollama'} response was truncated (hit MAX_TOKENS) before finishing. Raw partial output below:\n\n${text}`;

export async function generate(req: LLMRequest, config: Config, log: Logger, opts: EngineOptions = {}): Promise<LLMResult> {
  const e = env();
  const tries = opts.tries ?? e.LLM_MAX_TRIES;
  const delay = opts.retryDelayMs ?? e.LLM_RETRY_DELAY_MS;
  const timeoutMs = opts.timeoutMs ?? e.LLM_TIMEOUT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
  const providers: Record<Tier, Provider> = {
    gemini: opts.providers?.gemini ?? geminiProvider(),
    claude: opts.providers?.claude ?? claudeProvider(),
    ollama: opts.providers?.ollama ?? ollamaProvider(),
  };

  const attempts: AttemptLog[] = [];
  let truncatedFallback: { tier: Tier; out: ProviderOutput } | null = null;

  for (const tier of tierOrder(config)) {
    const p = providers[tier];
    const why = p.unavailable();
    if (why) {
      attempts.push({ tier, attempt: 0, ok: false, ms: 0, skipped: why });
      log.warn({ tier, kind: req.kind, reason: why }, 'LLM tier skipped');
      continue;
    }
    for (let attempt = 1; attempt <= tries; attempt++) {
      const t0 = Date.now();
      try {
        const out = await p.call(req, AbortSignal.timeout(timeoutMs));
        const rec: AttemptLog = { tier, attempt, ok: true, ms: Date.now() - t0, finishReason: out.finishReason };
        attempts.push(rec);
        if (out.truncated) {
          // Truncated output is usable but incomplete — prefer a later tier that finishes cleanly.
          log.warn({ ...rec, kind: req.kind }, 'LLM tier answered but output was truncated — trying next tier');
          truncatedFallback ??= { tier, out };
          break;
        }
        log.info({ ...rec, kind: req.kind, model: out.model, chars: out.text.length }, `LLM answered by ${tier}`);
        return { tier, model: out.model, text: out.text, finishReason: out.finishReason, truncated: false, attempts };
      } catch (err) {
        const le = err instanceof LLMError ? err
          : new LLMError((err as Error).name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : (err as Error).message, true);
        attempts.push({ tier, attempt, ok: false, ms: Date.now() - t0, status: le.status, error: le.message });
        const more = le.retryable && attempt < tries;
        log.warn({ tier, attempt, kind: req.kind, status: le.status, retryable: le.retryable, err: le.message }, more ? 'LLM attempt failed — retrying' : 'LLM tier failed');
        if (!more) break;
        await sleep(delay);
      }
    }
  }

  if (truncatedFallback) {
    const { tier, out } = truncatedFallback;
    log.warn({ tier, kind: req.kind }, 'no tier finished cleanly — shipping truncated output with warning banner');
    return { tier, model: out.model, text: truncationBanner(tier, out.text), finishReason: out.finishReason, truncated: true, attempts };
  }
  throw new AllTiersFailedError(attempts);
}
