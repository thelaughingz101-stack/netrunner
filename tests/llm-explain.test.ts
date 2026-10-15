import { describe, expect, it } from 'vitest';
import { allFailedMessage, attemptStage, whyFailed } from '../src/pipeline/llm/explain.js';
import type { AttemptLog } from '../src/pipeline/llm/types.js';

const overloaded = (attempt: number): AttemptLog => ({
  tier: 'gemini', attempt, ok: false, ms: 20_000, status: 503,
  error: 'gemini HTTP 503: {\n  "error": {\n    "code": 503,\n    "message": "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.",\n    "status": "UNAVAILABLE"\n  }\n}',
});
// The real failure from 2026-10-15: every AI failed, for three different reasons.
const real: AttemptLog[] = [
  { tier: 'gemini', attempt: 1, ok: false, ms: 270_000, error: 'gemini network error: fetch failed' },
  overloaded(2), overloaded(3), overloaded(4), overloaded(5),
  { tier: 'claude', attempt: 1, ok: false, ms: 300, status: 401, error: 'claude 401 error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}' },
  { tier: 'ollama', attempt: 1, ok: false, ms: 40, error: 'ollama unreachable at http://localhost:11434: ECONNREFUSED' },
];

describe('AI failures in plain words', () => {
  it('names what went wrong, and what to do about it', () => {
    const why = (a: Partial<AttemptLog>) => whyFailed({ tier: 'gemini', attempt: 1, ok: false, ms: 1, ...a });
    expect(why({ status: 503, error: overloaded(1).error })).toMatchObject({ what: 'was overloaded with requests', fix: expect.stringMatching(/Google's side.*minutes/) });
    expect(why({ tier: 'claude', status: 529, error: 'claude 529 error: Overloaded' }).fix).toMatch(/Anthropic's side/);
    expect(why({ tier: 'claude', status: 401, error: 'invalid x-api-key' })).toMatchObject({ what: 'rejected your API key', fix: 'Enter a new Claude key in AI Writer → API keys.' });
    expect(why({ status: 400, error: 'gemini HTTP 400: API key not valid. Please pass a valid API key.' }).what).toBe('rejected your API key');
    expect(why({ status: 429, error: 'RESOURCE_EXHAUSTED' }).what).toBe('hit its usage limit');
    expect(why({ attempt: 0, skipped: 'GEMINI_API_KEY not set' })).toMatchObject({ what: 'has no API key', fix: expect.stringContaining("ignore this if you don't use Gemini") });
    expect(why({ error: 'timed out after 704s — the model was still writing; raise LLM_TIMEOUT_MS' }).what).toBe('took too long to answer');
    expect(why({ error: 'gemini network error: fetch failed' })).toMatchObject({ what: "couldn't be reached", fix: expect.stringMatching(/internet connection/) });
    expect(why({ tier: 'ollama', error: 'ollama unreachable at http://localhost:11434: ECONNREFUSED' }).what).toBe("isn't running on this PC");
    expect(why({ status: 500, error: 'gemini HTTP 500: internal' }).what).toBe('had a server error');
    expect(why({ error: 'something nobody has seen before' }).what).toBe('failed: something nobody has seen before');
  });

  it('when no AI could write the digest, says what happened with each one', () => {
    expect(allFailedMessage(real, 'digest')).toBe([
      'No AI could write the digest:',
      "• Gemini couldn't be reached (try 1), then was overloaded with requests (tries 2–5). That's on Google's side and usually clears up within minutes: run it again later.",
      '• Claude rejected your API key. Enter a new Claude key in AI Writer → API keys.',
      "• Ollama isn't running on this PC. Start Ollama, or ignore this if you don't use it.",
    ].join('\n'));
  });

  it('the Run button hover says why it is retrying or switching, not just "try 4"', () => {
    const base = { tier: 'gemini' as const, of: 5, kind: 'digest' as const };
    expect(attemptStage({ ...base, attempt: 1 })).toBe('Writing the digest with Gemini');
    expect(attemptStage({ ...base, attempt: 4, previous: overloaded(3) })).toBe('Gemini was overloaded with requests, so trying again (attempt 4 of 5)');
    expect(attemptStage({ tier: 'claude', of: 5, kind: 'digest', attempt: 1, fallbackFrom: 'gemini', previous: overloaded(5) }))
      .toBe('Gemini was overloaded with requests, so writing the digest with Claude instead');
    expect(attemptStage({ ...base, kind: 'rollup', attempt: 1 })).toBe('Writing the recap with Gemini');
    expect(attemptStage({ ...base, kind: 'recovery', attempt: 1 })).toBe('Adding the stories the first draft missed, with Gemini');
    expect(attemptStage({ ...base, kind: 'recovery', attempt: 2, previous: overloaded(1) })).toBe('Adding the missed stories: Gemini was overloaded with requests, so trying again (attempt 2 of 5)');
  });
});
