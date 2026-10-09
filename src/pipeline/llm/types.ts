import type { DigestPrompt } from '../prompt/index.js';

export type Tier = 'gemini' | 'claude' | 'ollama';

export interface LLMRequest {
  /** digest = full digest, recovery = re-run for omitted items, rollup = weekly/monthly */
  kind: 'digest' | 'recovery' | 'rollup';
  prompt: DigestPrompt;
  /** Omission-protection tagging rule. Already inside prompt.system/geminiBody; Ollama's own
   *  RSS-only prompt doesn't include the system text, so it appends this separately. */
  idRule?: string;
}

export interface ProviderOutput {
  text: string;
  finishReason: string | null;
  truncated: boolean;
  model: string;
}

export interface Provider {
  tier: Tier;
  /** Reason the tier can't run at all (e.g. missing API key) — the chain skips it. */
  unavailable(): string | null;
  call(req: LLMRequest, signal: AbortSignal): Promise<ProviderOutput>;
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
}
