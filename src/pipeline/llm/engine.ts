// Three-tier fallback chain behind one interface. Order = config.llm.primary + fallbackChain
// (the UI's AI Engine tab — finally honored; n8n's canvas was hardwired Gemini → Claude).
import { env } from '../../env.js';
import type { Config } from '../../config/schema.js';
import type { Logger } from '../../logger.js';
import { claudeProvider } from './claude.js';
import { geminiProvider } from './gemini.js';
import { ollamaProvider } from './ollama.js';
import { allFailedMessage, type AttemptStart } from './explain.js';
import { LLMError, type AttemptLog, type LLMRequest, type LLMResult, type Provider, type ProviderOutput, type Tier } from './types.js';

export { LLMError };
export type { LLMRequest, LLMResult, Provider, Tier };

export interface EngineOptions {
  providers?: Partial<Record<Tier, Provider>>;
  tries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Called as each attempt starts (the app shows it on the Run button, see explain.ts attemptStage). */
  onAttempt?: (a: AttemptStart) => void;
}

/** Shown to the user (plain words, one line per AI); the raw errors are in `attempts`, the log and the run's stats. */
export class AllTiersFailedError extends Error {
  statusCode = 502; // upstream (LLM) failure, surfaced as-is to the UI
  constructor(public attempts: AttemptLog[], kind: LLMRequest['kind'] = 'digest') {
    super(allFailedMessage(attempts, kind));
    this.name = 'AllTiersFailedError';
  }
}

export const tierOrder = (config: Config): Tier[] => [...new Set([config.llm.primary, ...config.llm.fallbackChain])] as Tier[];

/**
 * Wait before the next try. When the AI says it's overloaded or rate-limited, wait longer each time (5 s,
 * 15 s, 45 s, then 2 min) so a demand spike can pass: the 2026-10-16 08:00 run spent all 5 tries inside two
 * minutes of Gemini "high demand". Other retryable errors keep the flat delay.
 */
export function retryDelay(base: number, attempt: number, status?: number, message = ''): number {
  const busy = status === 429 || status === 503 || status === 529 || /overloaded|high demand|RESOURCE_EXHAUSTED/i.test(message);
  return busy ? Math.min(base * 3 ** (attempt - 1), 120_000) : base;
}

type TimeoutEnv = Pick<ReturnType<typeof env>, 'LLM_TIMEOUT_MS' | 'LLM_TIMEOUT_PER_SOURCE_MS' | 'LLM_TIMEOUT_MAX_MS'>;

/** Per-call timeout for a digest built from `sources` feeds (custom ones included). The digest's length —
 *  and so the model's writing time — grows with the source count (~1.4s each measured on Gemini Flash). */
export function llmTimeoutFor(sources: number, e: TimeoutEnv = env()): number {
  return Math.min(e.LLM_TIMEOUT_MAX_MS, Math.max(e.LLM_TIMEOUT_MS, sources * e.LLM_TIMEOUT_PER_SOURCE_MS));
}

/** A piece of 1–20 characters repeated into a run of 200+: no real digest line has one. */
const RUNAWAY = /(.{1,20}?)\1{9,}/g;
const RUNAWAY_MIN = 200;

/**
 * Drops the lines where the AI got stuck repeating itself. On 2026-10-16 Gemini made up a Facebook link for a
 * Comics release and wrote ~35,000 "2"s into it: pages of them in the digest. The run can span several lines
 * (Gemini's text parts are joined with newlines), and each of those lines is dropped.
 */
export function dropRunaways(text: string): { text: string; dropped: number } {
  let dropped = 0;
  const kept = text.split('\n').filter(line => {
    for (const m of line.matchAll(RUNAWAY)) if (m[0].length >= RUNAWAY_MIN) { dropped++; return false; }
    return true;
  });
  return { text: dropped ? kept.join('\n') : text, dropped };
}

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
  let loopedFallback: { tier: Tier; out: ProviderOutput } | null = null;
  let firstTried: Tier | undefined;

  for (const tier of tierOrder(config)) {
    const p = providers[tier];
    const why = p.unavailable();
    if (why) {
      attempts.push({ tier, attempt: 0, ok: false, ms: 0, skipped: why });
      log.warn({ tier, kind: req.kind, reason: why }, 'LLM tier skipped');
      continue;
    }
    let loopedOnce = false;
    for (let attempt = 1; attempt <= tries; attempt++) {
      const t0 = Date.now();
      const signal = AbortSignal.timeout(timeoutMs);
      firstTried ??= tier;
      const previous = attempts.filter(a => !a.ok && !a.skipped).at(-1);
      opts.onAttempt?.({ tier, attempt, of: tries, kind: req.kind, ...(tier !== firstTried ? { fallbackFrom: firstTried } : {}), ...(previous ? { previous } : {}) });
      try {
        const raw = await p.call(req, signal);
        const { text, dropped } = dropRunaways(raw.text);
        const out = dropped ? { ...raw, text } : raw;
        if (dropped && !out.truncated) {
          // The rest of a looping answer is often muddled too (on 2026-10-16 Gemini started the Comics section over
          // and wrote it twice), so ask again once, then the next AI; failing those, ship it minus the broken lines.
          const error = `got stuck repeating itself (${dropped} broken line${dropped === 1 ? '' : 's'} dropped)`;
          attempts.push({ tier, attempt, ok: false, ms: Date.now() - t0, finishReason: out.finishReason, error });
          loopedFallback ??= { tier, out };
          const again = !loopedOnce && attempt < tries;
          log.warn({ tier, attempt, kind: req.kind, dropped }, again ? 'LLM got stuck repeating itself — asking again' : 'LLM got stuck repeating itself again — trying next tier');
          if (!again) break;
          loopedOnce = true;
          await sleep(delay);
          continue;
        }
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
        // Providers wrap the abort in their own message ("network error: …aborted"), so check the signal.
        // A timeout isn't retried: the identical request would just take as long again (×LLM_MAX_TRIES).
        const le = signal.aborted
          ? new LLMError(`timed out after ${Math.round(timeoutMs / 1000)}s — the model was still writing; raise LLM_TIMEOUT_MS or LLM_TIMEOUT_PER_SOURCE_MS in .env`, false)
          : err instanceof LLMError ? err
          : new LLMError((err as Error).name === 'TimeoutError' ? `timed out after ${timeoutMs}ms` : (err as Error).message, true);
        attempts.push({ tier, attempt, ok: false, ms: Date.now() - t0, status: le.status, error: le.message });
        const more = le.retryable && attempt < tries;
        log.warn({ tier, attempt, kind: req.kind, status: le.status, retryable: le.retryable, err: le.message }, more ? 'LLM attempt failed — retrying' : 'LLM tier failed');
        if (!more) break;
        await sleep(retryDelay(delay, attempt, le.status, le.message));
      }
    }
  }

  if (loopedFallback) {
    // Complete apart from the dropped lines (feed stories in them come back through the coverage check).
    const { tier, out } = loopedFallback;
    log.warn({ tier, kind: req.kind }, 'no tier answered without looping — shipping the answer minus the broken lines');
    return { tier, model: out.model, text: out.text, finishReason: out.finishReason, truncated: false, attempts };
  }
  if (truncatedFallback) {
    const { tier, out } = truncatedFallback;
    log.warn({ tier, kind: req.kind }, 'no tier finished cleanly — shipping truncated output with warning banner');
    return { tier, model: out.model, text: truncationBanner(tier, out.text), finishReason: out.finishReason, truncated: true, attempts };
  }
  throw new AllTiersFailedError(attempts, req.kind);
}
