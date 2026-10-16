// AI failures in plain words, for people rather than logs: the Run button's progress line while a run is
// retrying or switching AIs, and the error when none could write the digest. The raw error text stays in
// the log and the run's stats (llmAttempts).
import type { AttemptLog, LLMRequest, Tier } from './types.js';

const NAME: Record<Tier, string> = { gemini: 'Gemini', claude: 'Claude', ollama: 'Ollama' };
const COMPANY: Record<Tier, string> = { gemini: 'Google', claude: 'Anthropic', ollama: 'Ollama' };

export interface Why {
  /** Follows the AI's name: "Gemini was overloaded with requests". */
  what: string;
  /** What to do about it. */
  fix?: string;
}

/** Why one attempt failed. */
export function whyFailed(a: AttemptLog): Why {
  const name = NAME[a.tier];
  const text = `${a.skipped ?? ''} ${a.error ?? ''}`;
  const has = (re: RegExp) => re.test(text);
  if (a.skipped && has(/_KEY not set/)) {
    return { what: 'has no API key', fix: `Add a ${name} key in AI Writer → API keys, or ignore this if you don't use ${name}.` };
  }
  if (a.status === 401 || a.status === 403 || has(/invalid.{0,4}api.?key|api key not valid|authentication_error|permission_denied/i)) {
    return { what: 'rejected your API key', fix: `Enter a new ${name} key in AI Writer → API keys.` };
  }
  if (a.status === 429 || has(/RESOURCE_EXHAUSTED|rate.?limit|quota/i)) {
    return { what: 'hit its usage limit', fix: `Wait a while, or check the limits on your ${name} plan.` };
  }
  if (a.status === 503 || a.status === 529 || has(/overloaded|high demand|UNAVAILABLE/i)) {
    return { what: 'was overloaded with requests', fix: `That's on ${COMPANY[a.tier]}'s side and usually clears up within minutes: run it again later.` };
  }
  if (has(/repeating itself/)) {
    return { what: 'got stuck repeating itself' };
  }
  if (has(/timed out/i)) {
    return { what: 'took too long to answer', fix: 'Run it again, or turn off some topics or sources so the digest is smaller.' };
  }
  if (a.tier === 'ollama' && has(/ECONNREFUSED/)) {
    return { what: "isn't running on this PC", fix: "Start Ollama, or ignore this if you don't use it." };
  }
  if (has(/network error|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket|connection error/i)) {
    return { what: "couldn't be reached", fix: 'Check your internet connection, then run it again.' };
  }
  if (a.status !== undefined && a.status >= 500) {
    return { what: 'had a server error', fix: `That's on ${COMPANY[a.tier]}'s side: run it again later.` };
  }
  if (has(/no text|returned nothing|declined|blockReason/i)) {
    const block = text.match(/blockReason=(\w+)|refusal: (\w+)/);
    return { what: `refused to answer${block ? ` (${(block[1] ?? block[2]).toLowerCase()})` : ''}` };
  }
  return { what: `failed: ${(a.error ?? a.skipped ?? 'unknown error').split('\n')[0].slice(0, 160)}` };
}

const NOUN: Record<LLMRequest['kind'], string> = { digest: 'the digest', rollup: 'the recap', recovery: 'the missed stories' };

/** "try 1", "tries 2–5" */
const triesLabel = (nums: number[]) => nums.length === 1 ? `try ${nums[0]}` : `tries ${nums[0]}–${nums[nums.length - 1]}`;

/**
 * The error when every AI failed: one line per AI saying what happened (grouping repeated failures, e.g.
 * "overloaded (tries 2–5)") and what to do about the last one.
 */
export function allFailedMessage(attempts: AttemptLog[], kind: LLMRequest['kind']): string {
  const lines = [`No AI could write ${NOUN[kind]}:`];
  const tiers = [...new Set(attempts.map(a => a.tier))];
  for (const tier of tiers) {
    const failed = attempts.filter(a => a.tier === tier && !a.ok);
    if (!failed.length) continue;
    // Consecutive attempts that failed the same way become one group.
    const groups: { why: Why; nums: number[] }[] = [];
    for (const a of failed) {
      const why = whyFailed(a);
      const last = groups[groups.length - 1];
      if (last && last.why.what === why.what) last.nums.push(a.attempt);
      else groups.push({ why, nums: [a.attempt] });
    }
    const several = failed.length > 1;
    const story = groups.map(g => `${g.why.what}${several ? ` (${triesLabel(g.nums)})` : ''}`).join(', then ');
    const fix = groups[groups.length - 1].why.fix;
    lines.push(`• ${NAME[tier]} ${story}.${fix ? ` ${fix}` : ''}`);
  }
  return lines.join('\n');
}

export interface AttemptStart {
  tier: Tier;
  attempt: number;
  /** Tries allowed per AI. */
  of: number;
  kind: LLMRequest['kind'];
  /** The AI that was tried first, when this attempt is a fallback to another. */
  fallbackFrom?: Tier;
  /** The attempt that failed just before this one (skipped AIs aren't attempts). */
  previous?: AttemptLog;
}

/** The Run button's progress line as an AI attempt starts: says why it's retrying or switching. */
export function attemptStage(a: AttemptStart): string {
  const name = NAME[a.tier];
  const recovery = a.kind === 'recovery';
  if (!a.previous) return recovery ? `Adding the stories the first draft missed, with ${name}` : `Writing ${NOUN[a.kind]} with ${name}`;
  const failed = `${NAME[a.previous.tier]} ${whyFailed(a.previous).what}`;
  const next = a.previous.tier === a.tier
    ? `so trying again (attempt ${a.attempt} of ${a.of})`
    : recovery ? `so trying ${name} instead` : `so writing ${NOUN[a.kind]} with ${name} instead`;
  return recovery ? `Adding the missed stories: ${failed}, ${next}` : `${failed}, ${next}`;
}
