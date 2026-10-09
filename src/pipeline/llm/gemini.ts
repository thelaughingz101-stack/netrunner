// Port of n8n "Gemini API Call" (HTTP node) + "Parse Response".
import { env } from '../../env.js';
import { LLMError, type Provider } from './types.js';

export function geminiProvider(fetchImpl: typeof fetch = fetch): Provider {
  return {
    tier: 'gemini',
    unavailable: () => (env().GEMINI_API_KEY ? null : 'GEMINI_API_KEY not set'),
    async call(req, signal) {
      const e = env();
      const model = e.GEMINI_MODEL;
      let res: Response;
      try {
        res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          signal,
          // Header instead of n8n's ?key= query param — same auth, keeps the key out of URLs/logs.
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': e.GEMINI_API_KEY! },
          body: JSON.stringify(req.prompt.geminiBody), // body is exactly what Build LLM Payload produced
        });
      } catch (err) {
        throw new LLMError(`gemini network error: ${(err as Error).message}`, true);
      }
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        throw new LLMError(`gemini HTTP ${res.status}: ${body}`, res.status === 429 || res.status >= 500, res.status);
      }
      const data: any = await res.json();
      const candidate = data?.candidates?.[0];
      const finishReason: string | null = candidate?.finishReason ?? null;
      // drop any part flagged as internal thinking (Parse Response)
      const text = (candidate?.content?.parts || [])
        .filter((p: any) => p.text && !p.thought)
        .map((p: any) => p.text)
        .join('\n')
        .trim();
      if (!text) {
        const block = data?.promptFeedback?.blockReason;
        throw new LLMError(`gemini returned no text (finishReason=${finishReason}${block ? `, blockReason=${block}` : ''})`, false);
      }
      return { text, finishReason, truncated: finishReason === 'MAX_TOKENS', model };
    },
  };
}
