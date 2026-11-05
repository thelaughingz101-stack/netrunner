// AI graders: the judgments code can't make. Built the way Anthropic and OpenAI grade their own agents:
// - each criterion has its own rubric with an example of a violation and of a non-violation, and gets its own
//   reasoning, issues and verdict, scored separately;
// - reason first, then a specific, checkable answer: the numbers of the offending bullets and a pass / fail,
//   never a vague impression; "unknown" is allowed instead of guessing;
// - grade the outcome (the digest as delivered), not how it was written;
// - a different AI from the one that wrote the digest when one is available;
// - read-only: it reports, it never edits.
// All four criteria go in ONE request (Zion, 2026-10-22): one call per criterion is the stricter practice, but
// Gemini's free tier allows 20 requests a day and a digest run needs most of them.
// The score is computed here from the flagged bullets (partial credit), not taken from the judge, and flags that
// point at bullets that don't exist are dropped, so the grade can't be talked up or invented.
import type { Config } from '../../config/schema.js';
import type { Logger } from '../../logger.js';
import { generate, tierOrder, type EngineOptions } from '../llm/engine.js';
import type { LLMRequest, Tier } from '../llm/types.js';
import type { DigestPrompt } from '../prompt/index.js';
import type { CheckResult } from './checks.js';
import type { Bullet, ParsedDigest } from './parse.js';

/** Bullets sent to a judge at most (a digest past this is graded on its first ones, and says so). */
const MAX_BULLETS = 400;

interface Issue { bullets: number[]; why: string }
interface Verdict { reasoning: string; issues: Issue[]; verdict: 'pass' | 'fail' | 'unknown' }

interface Criterion {
  id: string;
  name: string;
  weight: number;
  /** Bullets allowed to break it before it fails: some slack for judgment calls. */
  allowed: (bullets: number) => number;
  rubric: string;
  /** The judge names groups of bullets (the same story twice) rather than single ones. */
  groups?: boolean;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const summaryOf = (b: Bullet) => { const i = b.text.indexOf(' — '); return i >= 0 ? b.text.slice(i + 3) : ''; };

const TOPIC_GUIDE = `Section meanings (broad buckets, not narrow labels): Gaming = video games, gaming hardware (consoles, GPUs, PCs) and the games industry; TV & Movies = film, TV, streaming, studios; Anime = Japanese animation; Animation = western animation (and animation craft generally); Music = music, artists, releases, tours, charts; Tech & Hardware = technology broadly: devices, software, vehicles and gadgets, platforms, tech companies, tech-angle science, self-hosting; AI & LLMs = artificial intelligence; US Politics = US government and politics; World News = news outside the US; Business & Finance = markets, economy, companies' finances; Science & Space = science, space, research; Health = public health, medicine, recalls; Weather & Disasters = severe weather, earthquakes, disasters; Security = cybersecurity, privacy, digital rights; Comics = comic books and publishers; Notable Trends = what's trending or viral; Blindspot Analysis = under-covered stories; Leaks & Rumors = unconfirmed leaks and rumors; Custom Feeds = the reader's own feeds (anything fits); Everything Else = stories that fit no topic above.`;

export const CRITERIA: Criterion[] = [
  {
    id: 'same-story', name: 'No story told twice in different words', weight: 2, groups: true,
    allowed: () => 0,
    rubric: `CRITERION: each real-world story appears in the digest once. Flag two or more bullets that report the SAME event, announcement or release, even when the headlines are worded differently or they sit in different sections.
NOT a violation: different stories about the same subject (a game's trailer and, separately, its delay; two different FDA recalls), or a follow-up that adds a genuinely new development.
Example violation: "#12 [Gaming] GTA 6 delayed to November 2026" and "#88 [Leaks & Rumors] Rockstar confirms Grand Theft Auto VI slips to November" → one issue with bullets [12, 88].
Example non-violation: "#5 Switch 2 sales top 20 million" and "#9 Switch 2 gets a price cut in Europe".
Each issue lists ALL bullet numbers that tell that one story.`,
  },
  {
    id: 'right-section', name: 'Each story in the right section', weight: 1,
    allowed: n => Math.floor(n * 0.1),
    // Calibrated 2026-10-22 on a real 325-bullet digest: "clearly belongs elsewhere" alone flagged 23% of it,
    // mostly stories that fit their section fine but another one slightly better.
    rubric: `CRITERION: no story is misfiled: each bullet has something to do with its section's topic.
${TOPIC_GUIDE}
Flag a bullet only when it has little or nothing to do with its own section AND plainly belongs to another one (say which). A story that fits its section reasonably well is NOT a violation, even if another section would fit as well or slightly better. Bullets in Everything Else are fine unless they plainly belong to one of the topic sections present in this digest.
Example violation: "#40 [Gaming] Federal Reserve holds interest rates steady" (nothing to do with games; Business & Finance).
Example violation: "#46 [Anime] Live-action Street Fighter film tops the box office" (not animation; TV & Movies).
Example non-violation: "#7 [Tech & Hardware] Nvidia unveils new AI chip" (fits Tech and AI alike).
Example non-violation: "#65 [Tech & Hardware] Electric motorbike review" or "#56 [Tech & Hardware] Frozen pig kidneys revived" (has a technology angle; Science would fit too).`,
  },
  {
    id: 'attribution', name: 'Claims attributed, rumors labeled, no editorializing', weight: 1.5,
    allowed: n => Math.floor(n * 0.03),
    // The headline is the outlet's own title, so only the summary is the digest's writing. Calibrated 2026-10-22:
    // judging the whole line flagged outlets' own headline wording ("Massive v1.1 Content Update OUT NOW!").
    rubric: `CRITERION: the digest's summaries report; they don't speculate or editorialize. Each bullet shows the outlet's own TITLE (never judge its wording: it's the outlet's, quoted as published), the SUMMARY the digest wrote, and the OUTLETS it names.
Flag a bullet whose SUMMARY (a) states a leak, rumor, insider claim or unconfirmed report as settled fact, or (b) adds the digest writer's own opinion or hype ("a must-play", "this is huge", "disappointing") rather than describing what the outlet reported.
NOT a violation: wording in the TITLE; attributed claims ("according to Insider Gaming…", "the FDA says…"); describing a review's or opinion piece's verdict as the outlet's ("PC Gamer calls it…"); items in Leaks & Rumors labeled as leaks or rumors; neutral descriptions.
Example violation: "TITLE: Half-Life 3 rumor | SUMMARY: Valve's next game is Half-Life 3 and it launches in March." (an unconfirmed rumor stated as fact).
Example non-violation: "TITLE: Massive v1.1 update OUT NOW! | SUMMARY: The update adds new rooms and decorations." (the hype is the outlet's title; the summary is neutral).`,
  },
  {
    id: 'filler', name: 'No filler, ads or forum posts as news', weight: 1,
    allowed: n => Math.floor(n * 0.05),
    // The digest's own rule (FILLER REJECTION): "subjective gameplay anecdotes, opinion pieces, and promotional
    // filler" go to EXCLUDED. Calibrated 2026-10-22: a looser "isn't news" flagged a third of a real digest,
    // explainers and the required market update included.
    rubric: `CRITERION: the digest's own filler rule: personal anecdotes, opinion pieces and promotional filler belong in the EXCLUDED list, not in a section. Flag a bullet that is one of these:
- a personal anecdote or first-person column ("I de-Googled my life for a week", "I use my keyboard knob to control my fans", "5 tools I rely on");
- an opinion piece or editorial whose point is the writer's view, not something that happened;
- promotional filler: an advertisement, a sponsored post, a "now available" spot for something already out, a promo code;
- a forum help request or chit-chat thread ("my console won't boot after a wipe", "Hello!", "what should I play?").
NOT a violation: news of any size; deals and price drops; reviews, previews and interviews; explainers and how-tos about current products or news; analysis; patch notes; release announcements; market updates; official advisories. When unsure, don't flag.
List one issue per bullet.
Example violation: "#140 [Everything Else] Pitch black screen after a TegraExplorer sysNAND wipe — a user asks for help".
Example non-violation: "#22 [Gaming] Elden Ring drops to $29.99 at Amazon (Wario64)" or "#70 [Tech & Hardware] How the Xbox disc-to-digital program works".`,
  },
];

const SYSTEM = `You are an impartial grader checking a news digest written by another AI. You do not rewrite, fix or improve anything: you check the digest against each criterion below, one at a time and independently, and report only clear violations of it.
Rules:
- Judge only what is in front of you. Do not use outside knowledge to decide whether a story is true.
- Flag a bullet only when it clearly violates the criterion you are checking. When in doubt, do not flag it.
- A bullet can break one criterion and not another: check each criterion separately.
- Refer to bullets by their # number exactly as given. Never invent numbers.
- For each criterion, think first: write your reasoning in "reasoning" (under 60 words), then the issues (each "why" under 15 words), then the verdict.
- "verdict" is "pass" when you found no violations of that criterion, "fail" when you found at least one, and "unknown" only if the input is unusable.
Answer with JSON only, no other text, one object per criterion id:
{"same-story": {"reasoning": "…", "issues": [{"bullets": [12, 88], "why": "short reason"}], "verdict": "pass" | "fail" | "unknown"}, "right-section": {…}, "attribution": {…}, "filler": {…}}`;

/** Each bullet, once, with everything the four criteria need: section, the outlet's title, the digest's summary, outlets. */
export const judgeRow = (b: Bullet) =>
  `#${b.n} [${b.section}] TITLE: ${cut(b.headline, 150)} | SUMMARY: ${cut(summaryOf(b), 320) || '(none)'} | OUTLETS: ${b.sources.length ? b.sources.join(', ') : '(none named)'}`;

export function judgePrompt(bullets: Bullet[], note = ''): DigestPrompt {
  const criteria = CRITERIA.map(c => `=== CRITERION "${c.id}" ===\n${c.rubric}`).join('\n\n');
  const user = `Check the digest below against each of these ${CRITERIA.length} criteria separately.\n\n${criteria}\n\nTHE DIGEST'S BULLETS (${bullets.length})${note}:\n${bullets.map(judgeRow).join('\n')}`;
  return {
    mode: 'grade',
    system: SYSTEM,
    user,
    geminiBody: {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      // Gemini's thinking counts against maxOutputTokens: unbounded, it used the whole budget on a 325-bullet
      // digest and the answer was cut off mid-JSON. A fixed thinking budget leaves room for the answer.
      generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 32768, thinkingConfig: { thinkingBudget: 8192 } },
    },
  };
}

/** An answer cut off mid-JSON: the issues written before the cut still count; the verdict follows from them. */
function salvage(text: string): Verdict | null {
  const issues = [...text.matchAll(/"bullets"\s*:\s*\[([\d,\s]*)\]\s*,\s*"why"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
    .map(m => ({ bullets: m[1].split(',').map(Number).filter(Number.isInteger), why: m[2].slice(0, 200) }));
  if (!issues.length && !/"issues"\s*:\s*\[\s*\]/.test(text)) return null;
  return { reasoning: '(answer cut short; issues found before the cut)', issues, verdict: issues.length ? 'fail' : 'pass' };
}

/** Turns a judge's answer into a check result: only real bullet numbers count; the score is computed here. */
export function scoreVerdict(c: Criterion, judged: Bullet[], v: Verdict, model: string): CheckResult {
  const byN = new Map(judged.map(b => [b.n, b]));
  const issues = v.issues
    .map(i => ({ ...i, bullets: [...new Set(i.bullets)].filter(n => byN.has(n)) }))
    .filter(i => i.bullets.length >= (c.groups ? 2 : 1));
  // A repeated story counts every copy after the first; other criteria count each flagged bullet once.
  const flagged = new Set(issues.flatMap(i => (c.groups ? i.bullets.slice(1) : i.bullets)));
  const total = judged.length;
  const base = { id: c.id, name: c.name, grader: 'ai' as const, weight: c.weight };
  if (v.verdict === 'unknown' && !issues.length) {
    return { ...base, score: 1, pass: true, summary: `The AI grader couldn't judge this (${model})`, evidence: [], skipped: 'The AI grader answered "unknown"' };
  }
  const evidence = issues.slice(0, 8).map(i => `${i.bullets.map(n => `#${n} [${byN.get(n)!.section}] ${cut(byN.get(n)!.headline, 90)}`).join(' = ')} — ${i.why}`);
  return {
    ...base,
    score: total ? Math.max(0, 1 - flagged.size / total) : 1,
    pass: flagged.size <= c.allowed(total),
    summary: issues.length ? `${issues.length} problem${issues.length === 1 ? '' : 's'} found (${flagged.size} of ${total} bullets)` : `None found in ${total} bullets`,
    evidence,
  };
}

/** One criterion's part of the answer (an object, or nothing usable). */
function toVerdict(v: any): Verdict | null {
  if (!v || typeof v !== 'object') return null;
  const issues: Issue[] = Array.isArray(v.issues) ? v.issues.map((i: any) => ({
    bullets: (Array.isArray(i.bullets) ? i.bullets : [i.bullet ?? i.bullets]).map(Number).filter(Number.isInteger),
    why: String(i.why ?? i.reason ?? '').slice(0, 200),
  })) : [];
  const verdict = v.verdict === 'pass' || v.verdict === 'fail' || v.verdict === 'unknown' ? v.verdict : issues.length ? 'fail' : 'pass';
  return { reasoning: String(v.reasoning ?? '').slice(0, 2000), issues, verdict };
}

/**
 * The judge's answer, criterion by criterion (tolerating code fences or a sentence around it). An answer cut
 * off mid-JSON keeps what each criterion had before the cut; a criterion it never reached is null.
 */
export function parseVerdicts(text: string): Record<string, Verdict | null> {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const all = JSON.parse(text.slice(start, end + 1));
      return Object.fromEntries(CRITERIA.map(c => [c.id, toVerdict(all[c.id])]));
    } catch { /* cut off: salvage below */ }
  }
  const at = CRITERIA.map(c => ({ id: c.id, i: text.indexOf(`"${c.id}"`) })).filter(x => x.i >= 0).sort((a, b) => a.i - b.i);
  const out: Record<string, Verdict | null> = Object.fromEntries(CRITERIA.map(c => [c.id, null]));
  at.forEach((x, k) => { out[x.id] = salvage(text.slice(x.i, at[k + 1]?.i ?? text.length)); });
  return out;
}

/**
 * The AIs to grade with: any but the one that wrote the digest first (a second opinion), that one last. Never a
 * local model: the grading request is longer than a small one can read, and it has to answer in exact JSON.
 * null when only a local model is set up (the code checks still run).
 */
export function graderConfig(config: Config, writer?: Tier): Config | null {
  const order = tierOrder(config).filter(t => t !== 'ollama');
  const tiers = writer ? [...order.filter(t => t !== writer), ...order.filter(t => t === writer)] : order;
  return tiers.length ? { ...config, llm: { ...config.llm, primary: tiers[0], fallbackChain: tiers.slice(1) } } : null;
}

/** All four criteria in one request; each comes back with its own verdict and is scored on its own. */
export async function runJudges(parsed: ParsedDigest, config: Config, log: Logger, engine: EngineOptions = {}, writer?: Tier): Promise<{ checks: CheckResult[]; model: string | null }> {
  const all = parsed.bullets.filter(b => b.kind !== 'updates');
  const judged = all.slice(0, MAX_BULLETS);
  const skip = (summary: string, skipped: string) =>
    CRITERIA.map((c): CheckResult => ({ id: c.id, name: c.name, grader: 'ai', weight: c.weight, score: 1, pass: true, evidence: [], summary, skipped }));
  if (!judged.length) return { checks: skip('Nothing to judge', 'No bullets'), model: null };
  const graders = graderConfig(config, writer);
  if (!graders) return { checks: skip("Not graded: these checks need Gemini or Claude (a local model can't grade)", 'No online AI'), model: null };
  const note = all.length > judged.length ? ` — the first ${judged.length} of ${all.length}` : '';
  try {
    const req: LLMRequest = { kind: 'grade', prompt: judgePrompt(judged, note) };
    const res = await generate(req, graders, log, { ...engine, tries: Math.min(engine.tries ?? 3, 3) });
    const verdicts = parseVerdicts(res.text);
    const checks = CRITERIA.map((c): CheckResult => {
      const v = verdicts[c.id];
      return v ? scoreVerdict(c, judged, v, res.model)
        : { id: c.id, name: c.name, grader: 'ai', weight: c.weight, score: 1, pass: true, evidence: [], summary: "The AI grader's answer for this couldn't be read", skipped: 'Unreadable answer' };
    });
    return { checks, model: `${res.tier}:${res.model}` };
  } catch (e) {
    log.warn({ err: (e as Error).message }, 'AI grader failed');
    return { checks: skip(`Not graded: ${(e as Error).message.split('\n').slice(0, 2).join(' ')}`, 'No AI could grade it'), model: null };
  }
}
