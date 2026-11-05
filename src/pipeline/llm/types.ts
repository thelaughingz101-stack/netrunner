import type { Config } from '../../config/schema.js';
import type { DigestPrompt } from '../prompt/index.js';
import type { Item } from '../types.js';
import type { LocalStats } from './local.js';

export type Tier = 'gemini' | 'claude' | 'ollama';

export interface LLMRequest {
  /** digest = full digest, recovery = re-run for omitted items, rollup = weekly/monthly, grade = the AI grader */
  kind: 'digest' | 'recovery' | 'rollup' | 'grade';
  prompt: DigestPrompt;
  /** The stories behind a digest or missed-stories request. A local model writes them itself, one at a time
   *  (local.ts), instead of reading the whole prompt; the online AIs ignore this. */
  stories?: { items: Item[]; config: Config; onProgress?: (stage: string) => void };
}

export interface ProviderOutput {
  text: string;
  finishReason: string | null;
  truncated: boolean;
  model: string;
  /** What the local model did (local.ts). */
  local?: LocalStats;
}

export interface Provider {
  tier: Tier;
  /** Reason the tier can't run at all (e.g. missing API key) — the chain skips it. */
  unavailable(): string | null;
  call(req: LLMRequest, signal: AbortSignal): Promise<ProviderOutput>;
  /** Waits for this AI to be free and returns the release; the attempt's clock starts after it (Ollama). */
  slot?(): Promise<() => void>;
  /** This request's time allowance, when it isn't the usual one (Ollama: by the number of stories). */
  timeoutMs?(req: LLMRequest, base: number): number;
}

export class LLMError extends Error {
  constructor(message: string, public retryable: boolean, public status?: number) {
    super(message);
    this.name = 'LLMError';
  }
}

export interface AttemptLog {
  tier: Tier;
  attempt: number;
  ok: boolean;
  ms: number;
  status?: number;
  finishReason?: string | null;
  error?: string;
  skipped?: string;
}

export interface LLMResult {
  tier: Tier;
  model: string;
  text: string;
  finishReason: string | null;
  truncated: boolean;
  attempts: AttemptLog[];
  local?: LocalStats;
}
