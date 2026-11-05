// Format → Summary length, enforced on the written digest. The AIs drift: with "One sentence" on, Gemini still
// wrote two for 16 of 203 stories (digest 35, 2026-10-26). Cutting at a sentence end never adds anything, so
// the longest a summary can be is the setting's; a summary shorter than asked stays (the feed may say no more).
import { sentences } from './llm/local.js';

/** The most sentences a summary may have, by setting. */
const MAX_SENTENCES: Record<string, number> = { '1': 1, '2-3': 3, full: 5 };

// "- [**Headline**](url) — summary *(Outlet)*" or "- **Headline** — summary *(Outlet)*" (EXCLUDED lines,
// "— reason: …", have no outlet in this form and are left alone).
const BULLET = /^(\s*[-*] (?:\[\*\*.+?\*\*\]\([^)]*\)|\*\*.+?\*\*) — )(.+?)( \*\([^)]+\)\*.*)$/;

export function capSummaries(md: string, summaryLength: string): { md: string; cut: number } {
  const max = MAX_SENTENCES[summaryLength] ?? 3;
  let cut = 0;
  const out = md.split('\n').map(line => {
    const m = line.match(BULLET);
    if (!m) return line;
    const { done } = sentences(m[2]);
    if (done.length <= max) return line;
    cut++;
    return `${m[1]}${done.slice(0, max).join(' ')}${m[3]}`;
  });
  return { md: cut ? out.join('\n') : md, cut };
}
