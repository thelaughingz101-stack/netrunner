// Code graders: everything about a digest that can be checked exactly. They're fast, free, and give the same
// answer every time, so they go first; the AI graders (judge.ts) only judge what code can't.
import { isOfficial } from '../../catalog/index.js';
import type { Config } from '../../config/schema.js';
import { isPromotionalTitle, isShort } from '../ingest/filters.js';
import { dropRunaways } from '../llm/engine.js';
import type { Bullet, ParsedDigest } from './parse.js';

export interface CheckResult {
  id: string;
  /** What it checks, in plain words. */
  name: string;
  grader: 'code' | 'ai';
  /** 0–1: partial credit, e.g. 0.96 when 4% of the bullets break the rule. */
  score: number;
  pass: boolean;
  /** Failing it fails the digest whatever the score (a switched-off topic showing up, a looping answer…). */
  critical?: boolean;
  weight: number;
  /** One line: what was found. */
  summary: string;
  /** The offending lines, so the verdict can be checked by eye. */
  evidence: string[];
  /** Couldn't be checked (no run record, the AI grader unavailable…): left out of the score. */
  skipped?: string;
}

export interface CheckInput {
  digest: string;
  parsed: ParsedDigest;
  /** The settings the digest was written with, when known. */
  config?: Config;
  /** The run's stats (coverage, failed topics), when the digest came from a run. */
  runStats?: Record<string, any> | null;
}

const MAX_EVIDENCE = 8;
const show = (b: Bullet, why = '') => `#${b.n} [${b.section}] ${b.headline.slice(0, 140)}${why ? ` — ${why}` : ''}`;
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

function result(c: Omit<CheckResult, 'grader' | 'evidence'> & { evidence?: string[] }): CheckResult {
  return { grader: 'code', ...c, score: Math.max(0, Math.min(1, c.score)), evidence: (c.evidence ?? []).slice(0, MAX_EVIDENCE) };
}
const skipped = (id: string, name: string, weight: number, why: string, critical?: boolean): CheckResult =>
  result({ id, name, weight, critical, score: 1, pass: true, summary: why, skipped: why });

/** Share of bullets breaking a rule → score; passes up to `allowed` of them. */
function ratioCheck(id: string, name: string, weight: number, bad: { b: Bullet; why: string }[], total: number, allowed: number, ok: string, what: string): CheckResult {
  const pass = bad.length <= allowed;
  return result({
    id, name, weight, score: total ? 1 - bad.length / total : 1, pass,
    summary: bad.length ? `${bad.length} of ${total} bullets (${pct(bad.length, total)}%) ${what}` : ok,
    evidence: bad.map(x => show(x.b, x.why)),
  });
}

/** Story bullets: topic sections and Everything Else (not Story Updates, which revisits this morning's stories). */
const storyBullets = (p: ParsedDigest) => p.bullets.filter(b => b.kind === 'topic' || b.kind === 'else' || b.kind === 'unknown');

export function sectionsOn({ parsed, config }: CheckInput): CheckResult {
  const id = 'sections-on', name = 'Only the topics you switched on', weight = 2;
  if (!config) return skipped(id, name, weight, 'No settings to check against', true);
  const off = parsed.sections.filter(s => s.kind === 'topic' && config.topics[s.topic!] === false);
  const unknown = parsed.sections.filter(s => s.kind === 'unknown');
  const bad = [...off.map(s => `${s.header} — this topic is switched off`), ...unknown.map(s => `${s.header} — not one of your sections`)];
  return result({
    id, name, weight, critical: off.length > 0, score: bad.length ? 0 : 1, pass: !bad.length,
    summary: bad.length ? `${bad.length} section${bad.length === 1 ? '' : 's'} that shouldn't be there` : 'Every section is a topic you have on',
    evidence: bad,
  });
}

export function sectionOrder({ parsed, config }: CheckInput): CheckResult {
  const id = 'section-order', name = 'Sections in your order', weight = 1;
  if (!config) return skipped(id, name, weight, 'No settings to check against');
  const order = config.format.sectionOrder;
  const seen = parsed.sections.filter(s => s.kind === 'topic' && order.includes(s.topic!)).map(s => s.topic!);
  const wrong: string[] = [];
  for (let i = 1; i < seen.length; i++) if (order.indexOf(seen[i]) < order.indexOf(seen[i - 1])) wrong.push(`${seen[i]} comes after ${seen[i - 1]}`);
  return result({ id, name, weight, score: seen.length > 1 ? 1 - wrong.length / (seen.length - 1) : 1, pass: !wrong.length,
    summary: wrong.length ? `${wrong.length} section${wrong.length === 1 ? '' : 's'} out of order` : 'Matches your section order', evidence: wrong });
}

export function catchAll({ parsed }: CheckInput): CheckResult {
  const id = 'catch-all', name = 'Everything Else and EXCLUDED are there', weight = 0.5;
  const missing = (['else', 'excluded'] as const).filter(k => !parsed.sections.some(s => s.kind === k)).map(k => (k === 'else' ? 'Everything Else' : 'EXCLUDED'));
  return result({ id, name, weight, score: 1 - missing.length / 2, pass: !missing.length,
    summary: missing.length ? `Missing: ${missing.join(', ')}` : 'Both catch-all sections are there', evidence: missing });
}

const storyKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// By headline only: a shared link isn't the same story (the AI sometimes gives several stories one agency's
// news index page; that's a link problem, see links()).
export function repeats({ parsed }: CheckInput): CheckResult {
  const id = 'repeats', name = 'No story twice (same headline)', weight = 2;
  const bullets = storyBullets(parsed);
  const byKey = new Map<string, Bullet>();
  const bad: { b: Bullet; why: string }[] = [];
  for (const b of bullets) {
    const k = storyKey(b.headline);
    if (!k) continue;
    const first = byKey.get(k);
    if (first) bad.push({ b, why: `repeats #${first.n} [${first.section}]` });
    else byKey.set(k, b);
  }
  return ratioCheck(id, name, weight, bad, bullets.length, 0, 'No repeated stories', 'repeat an earlier story');
}

export function leftoverTags({ digest }: CheckInput): CheckResult {
  const id = 'leftover-tags', name = 'No leftover story tags', weight = 1;
  const lines = digest.split('\n').filter(l => /\[#?N\d{3,}\]|\[cite:/i.test(l));
  return result({ id, name, weight, critical: lines.length > 0, score: lines.length ? 0 : 1, pass: !lines.length,
    summary: lines.length ? `${lines.length} line${lines.length === 1 ? '' : 's'} still show [#N…] or [cite: …] tags` : 'No tags left in the text',
    evidence: lines.map(l => l.trim().slice(0, 160)) });
}

export function loops({ digest }: CheckInput): CheckResult {
  const id = 'loops', name = 'No looping text', weight = 2;
  const { dropped } = dropRunaways(digest);
  return result({ id, name, weight, critical: dropped > 0, score: dropped ? 0 : 1, pass: !dropped,
    summary: dropped ? `${dropped} line${dropped === 1 ? '' : 's'} where the AI got stuck repeating itself` : 'No runaway repeats' });
}

export function complete({ digest }: CheckInput): CheckResult {
  const id = 'complete', name = 'The answer was finished', weight = 2;
  const cut = /response was truncated/i.test(digest);
  return result({ id, name, weight, critical: cut, score: cut ? 0 : 1, pass: !cut,
    summary: cut ? 'The AI ran out of room and stopped mid-digest' : 'The AI finished its answer' });
}

export function filtered({ parsed, config }: CheckInput): CheckResult {
  const id = 'filtered', name = 'Nothing your filters drop', weight = 1;
  const bullets = storyBullets(parsed);
  const promo = config?.filters.promotional !== false, shorts = config?.filters.shorts !== false;
  const bad = bullets.flatMap(b => {
    if (shorts && (isShort(b.link ?? '', b.headline) || /\[SHORT\]/.test(b.headline))) return [{ b, why: 'a YouTube Short' }];
    if (promo && isPromotionalTitle(b.headline)) return [{ b, why: 'a promo clip/spot' }];
    return [];
  });
  return ratioCheck(id, name, weight, bad, bullets.length, 0, 'No Shorts or promo clips got through', 'are things Skip filler should have dropped');
}

// Written without a link on purpose, by the prompt's own rules: ComicBookMovie stories, and the Comics
// section's weekly release list (issue titles under publisher headings; they still have to name a source).
const linkless = (b: Bullet) => b.sources.some(s => /comicbookmovie/i.test(s)) || b.topic === 'Comics';

export function links({ parsed }: CheckInput): CheckResult {
  const bullets = storyBullets(parsed);
  const firstWithLink = new Map<string, Bullet>();
  const bad = bullets.flatMap(b => {
    if (!b.link) return linkless(b) ? [] : [{ b, why: 'no link' }];
    if (!/^https?:\/\//i.test(b.link)) return [{ b, why: `not a web link (${b.link.slice(0, 40)})` }];
    if (/news\.google\.com\//i.test(b.link)) return [{ b, why: 'still a Google News link' }];
    if (/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/i.test(b.link)) return [{ b, why: "a Google search redirect, not the article's own address" }];
    const first = firstWithLink.get(b.link);
    if (!first) { firstWithLink.set(b.link, b); return []; }
    return storyKey(first.headline) === storyKey(b.headline) ? [] : [{ b, why: `same link as #${first.n}, so not this story's own page` }];
  });
  return ratioCheck('links', 'Every story links to its source', 1, bad, bullets.length, Math.floor(bullets.length * 0.03), 'Every story has a working web link', 'have no usable link');
}

export function sourcesNamed({ parsed }: CheckInput): CheckResult {
  const bullets = storyBullets(parsed);
  const bad = bullets.filter(b => !b.sources.length).map(b => ({ b, why: 'no *(Source)* at the end' }));
  return ratioCheck('sources-named', 'Every story names its outlet', 1, bad, bullets.length, Math.floor(bullets.length * 0.03), 'Every story names its outlet', "don't name an outlet");
}

export function officialFirst({ parsed }: CheckInput): CheckResult {
  const shared = storyBullets(parsed).filter(b => b.sources.length > 1 && b.sources.some(isOfficial));
  const bad = shared.filter(b => !isOfficial(b.sources[0])).map(b => ({ b, why: `${b.sources.find(isOfficial)} should come first (${b.sources.join(', ')})` }));
  const r = ratioCheck('official-first', 'Official bodies named first', 0.5, bad, shared.length, 0, shared.length ? 'Official bodies lead every story they share' : 'No story shared by an official body and the press', 'name the press before the official body');
  return shared.length ? r : { ...r, skipped: 'No story shared by an official body and the press' };
}

export function coverage({ runStats }: CheckInput): CheckResult {
  const id = 'coverage', name = 'Every story accounted for by the AI', weight = 2;
  const c = runStats?.coverage;
  if (!c?.expected) return skipped(id, name, weight, 'No run record for this digest');
  const forced = c.forced ?? 0;
  return result({ id, name, weight, score: 1 - forced / c.expected, pass: forced / c.expected <= 0.05,
    summary: forced ? `The AI skipped ${forced} of ${c.expected} stories (${pct(forced, c.expected)}%); NetRunner added them as plain headlines` : `The AI placed all ${c.expected} stories itself` });
}

export function topicsWritten({ parsed, runStats }: CheckInput): CheckResult {
  const id = 'topics-written', name = 'Every topic written', weight = 1.5;
  const fromNote = parsed.pre.match(/Some topics couldn't be written: ([^.*]+)\./)?.[1]?.split(/,\s*/) ?? [];
  const failed: string[] = runStats?.llm?.failedTopics ?? fromNote;
  const total = Math.max(runStats?.llm?.calls ?? parsed.sections.filter(s => s.kind === 'topic').length, failed.length, 1);
  return result({ id, name, weight, score: 1 - failed.length / total, pass: !failed.length,
    summary: failed.length ? `Listed as plain headlines (the AI couldn't write them): ${failed.join(', ')}` : 'The AI wrote every topic', evidence: failed });
}

/**
 * The feeds the user added themselves are in the digest, not dropped as filler. On 2026-10-26 Gemini put all 31
 * stories from Zion's own game feed in EXCLUDED ("filler") and the grade still said 99/100. A duplicate of a
 * story told elsewhere may be left out, hence the allowance.
 */
export function customFeedsShown({ runStats }: CheckInput): CheckResult {
  const id = 'custom-feeds', name = 'Your own feeds are in the digest', weight = 2;
  const c = runStats?.customFeeds;
  if (!c?.stories) return skipped(id, name, weight, 'No stories from your own feeds in this run');
  const shown = c.stories - c.excluded;
  return result({ id, name, weight, score: shown / c.stories, pass: c.excluded <= Math.max(1, Math.floor(c.stories * 0.2)),
    summary: c.excluded ? `${c.excluded} of ${c.stories} stories from your own feeds were left out (EXCLUDED)` : `All ${c.stories} stories from your own feeds are in` });
}

export const CODE_CHECKS = [sectionsOn, sectionOrder, catchAll, repeats, leftoverTags, loops, complete, filtered, links, sourcesNamed, officialFirst, coverage, topicsWritten, customFeedsShown];

export const runCodeChecks = (input: CheckInput): CheckResult[] => CODE_CHECKS.map(check => check(input));
