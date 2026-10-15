// HTTP for AI calls that send nothing back until the whole answer is written (Gemini generateContent,
// Ollama with stream:false). Node's built-in fetch gives up on any response that takes more than 5 minutes
// to start (undici's headersTimeout) and reports only "fetch failed", whatever the call's AbortSignal allows:
// a big digest that took Gemini 6 minutes failed even with LLM_TIMEOUT_MS at 12. Here the AbortSignal
// (LLM_TIMEOUT_MS and friends) alone decides how long to wait.
import { Agent, fetch as undiciFetch } from 'undici';

const patient = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

export const llmFetch = ((input: string | URL, init?: RequestInit) =>
  undiciFetch(input, { ...(init as object), dispatcher: patient })) as unknown as typeof fetch;

/** "fetch failed (UND_ERR_HEADERS_TIMEOUT)": fetch's own message hides why, in err.cause. */
export function networkDetail(err: unknown): string {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  const why = e.cause?.code ?? e.cause?.message;
  return why && !e.message.includes(why) ? `${e.message} (${why})` : e.message;
}
