// Port of n8n "Ollama RSS-Only Mode" → "Basic LLM Chain" (Ollama Chat Model) → "Parse Ollama Output".
// Those nodes were disabled in n8n; this is the first time the tier is actually wired.
import { env } from '../../env.js';
import { LLMError, type LLMRequest, type Provider } from './types.js';

/** Prompt text verbatim from "Ollama RSS-Only Mode"; `items` is Build LLM Payload's user message. */
export function ollamaRssOnlyPrompt(items: string): string {
  return `You are a news digest agent. IMPORTANT LIMITATIONS: You have NO internet access and NO ability to search. You MUST ONLY use the RSS feed items provided below.

STRICT RULES:
- Only summarize what is explicitly in the RSS items below
- Do NOT add stock prices, trending topics, leaks, or political news — you have no way to verify these
- Do NOT use your training data to fill gaps
- If a section has no RSS data, write "No data available — live search unavailable"
- Skip these sections entirely (require live data you don't have):
  - X/Twitter Trending Topics
  - Stock market numbers
  - Leaks & Rumors (cannot verify)
  - Premarket/market close data

Only include sections you can fill from the RSS items provided:

## 🎮 Gaming
## 🖥️ Tech & Hardware
## 🤖 AI & LLMs
## 🎬 TV & Movies
## 🎙️ Media Announcements
## 📚 Comics

FORMAT: Clean Markdown. ## headers. Bold bullet headlines.
Each item: - **Headline** — one-line summary. *(source)*
No preamble. Just the digest. Note at the top: "⚠️ Fallback digest — live data unavailable. RSS sources only."

RSS ITEMS:
${items}`;
}

function promptFor(req: LLMRequest): string {
  // Digests use the RSS-only prompt (as n8n did). Rollups/recovery send the request as-is.
  return req.kind === 'digest'
    ? ollamaRssOnlyPrompt(req.prompt.user) + (req.idRule ? `\n\n${req.idRule}` : '')
    : `${req.prompt.system}\n\n${req.prompt.user}`;
}

export function ollamaProvider(fetchImpl: typeof fetch = fetch): Provider {
  return {
    tier: 'ollama',
    unavailable: () => (env().OLLAMA_URL ? null : 'OLLAMA_URL not set'),
    async call(req, signal) {
      const e = env();
      let res: Response;
      try {
        res = await fetchImpl(`${e.OLLAMA_URL.replace(/\/$/, '')}/api/generate`, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          // Ollama defaults to a 2048-token context, which silently drops most of the feed.
          body: JSON.stringify({ model: e.OLLAMA_MODEL, prompt: promptFor(req), stream: false, options: { num_ctx: 8192 } }),
        });
      } catch (err) {
        const msg = (err as Error & { cause?: { code?: string } }).cause?.code ?? (err as Error).message;
        // Nothing listening → retrying won't help.
        throw new LLMError(`ollama unreachable at ${e.OLLAMA_URL}: ${msg}`, msg !== 'ECONNREFUSED');
      }
      if (!res.ok) throw new LLMError(`ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status >= 500, res.status);
      const data: any = await res.json();
      const text = (data?.response || '').trim();
      if (!text) throw new LLMError('ollama returned no text', false);
      // Parse Ollama Output's banner (digests only)
      const out = req.kind === 'digest' ? `⚠️ FALLBACK DIGEST (Gemini unavailable — RSS only)\n\n${text}` : text;
      return { text: out, finishReason: data?.done_reason ?? null, truncated: data?.done_reason === 'length', model: e.OLLAMA_MODEL };
    },
  };
}
