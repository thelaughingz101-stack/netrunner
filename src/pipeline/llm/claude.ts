// Port of n8n "Claude API Fallback" + "Parse Claude Response", now via the official SDK.
// Same inputs as n8n: Build LLM Payload's system prompt + user message, web search (max 8 uses).
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../env.js';
import { LLMError, type Provider } from './types.js';

const MAX_CONTINUATIONS = 5; // server-tool turns can pause; resume at most this many times

export function claudeProvider(makeClient?: () => Anthropic): Provider {
  return {
    tier: 'claude',
    unavailable: () => (env().ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY not set'),
    async call(req, signal) {
      const e = env();
      // Retries are done by the chain runner so every attempt is logged the same way across tiers.
      const client = makeClient?.() ?? new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, maxRetries: 0, timeout: e.LLM_TIMEOUT_MS });
      const model = e.CLAUDE_MODEL;
      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: req.prompt.user }];
      let final: Anthropic.Message | undefined;
      try {
        for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
          // Streaming: digests are long, and a large max_tokens on a non-streaming call can hit HTTP timeouts.
          final = await client.messages.stream({
            model,
            max_tokens: 32000,
            system: req.prompt.system,
            tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
            messages,
          }, { signal }).finalMessage();
          if (final.stop_reason !== 'pause_turn') break;
          messages.push({ role: 'assistant', content: final.content });
        }
      } catch (err) {
        if (err instanceof Anthropic.APIError) {
          const status = err.status;
          const retryable = status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
          throw new LLMError(`claude ${status ?? 'connection'} error: ${err.message}`, retryable, status);
        }
        throw new LLMError(`claude error: ${(err as Error).message}`, true);
      }
      if (!final) throw new LLMError('claude returned nothing', true);
      if (final.stop_reason === 'refusal') {
        // Haiku has no server-side fallback; the chain moves on to the next tier instead.
        throw new LLMError(`claude declined (refusal${final.stop_details?.category ? `: ${final.stop_details.category}` : ''})`, false);
      }
      // Text blocks are fragments split around citations, so join without separators
      // (n8n joined with '\n', which broke sentences mid-line — see CHANGES_FROM_N8N.md).
      const text = final.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('').trim();
      if (!text) throw new LLMError(`claude returned no text (stop_reason=${final.stop_reason})`, false);
      return { text, finishReason: final.stop_reason, truncated: final.stop_reason === 'max_tokens', model };
    },
  };
}
