// Omission protection: ID-injection + programmatic diff + targeted re-run.
// The prompt's COVERAGE WINS / EXCLUDED-ledger wording stays as a first layer, but nothing
// relies on it: every feed item gets an ID, the output is diffed against the ID set, and
// only the missing items are re-sent. Anything still missing is placed deterministically.
import type { DigestPrompt, GeminiBody } from '../prompt/index.js';
import type { Item } from '../types.js';

export const EXCLUDED_HEADER = '## 🗒️ EXCLUDED';
export const EVERYTHING_ELSE_HEADER = '## 📋 Everything Else';
const TAG_RE = /\[#(N\d{3,})\]/g;
const HAS_TAG = /\[#N\d{3,}\]/;

/** N001, N002, … in feed order (zero-padded to the feed size so they sort lexically). */
export function assignIds(items: Item[]): Item[] {
  const width = Math.max(3, String(items.length).length);
  return items.map((it, i) => ({ ...it, id: `N${String(i + 1).padStart(width, '0')}` }));
}

export const ID_RULE = `ITEM IDS (machine-checked — every FEED item in the JSON has an "id" field such as "N017"):
- End EVERY bullet that reports a FEED item — in a topic section, 📋 Everything Else, or the 🗒️ EXCLUDED ledger — with that item's id tag in square brackets, e.g. "- [**Headline**](url) — summary. *(Source)* [#N017]".
- This includes EVERY 🗒️ EXCLUDED line: "- Headline (Source) — reason: filler [#N042]". An untagged ledger line does not count.
- One tag per bullet. Search-sourced items (not in the feed JSON) get NO tag. Never invent an id.
- Your output is checked programmatically against the full id list; any untagged feed item counts as dropped.`;

/** Adds the tagging rule to the system prompt (and the identical Gemini systemInstruction). */
export function withIdRule(prompt: DigestPrompt): DigestPrompt {
  const system = `${prompt.system}\n\n${ID_RULE}`;
  const geminiBody: GeminiBody = structuredClone(prompt.geminiBody);
  geminiBody.systemInstruction.parts[0].text = system;
  return { ...prompt, system, geminiBody };
}

export interface CoverageReport {
  expected: number;
  found: Map<string, 'section' | 'excluded'>;
  missing: string[];
  unknown: string[];
}

/** Which ids appear in the output, and whether in a section or the EXCLUDED ledger. */
export function diffCoverage(output: string, ids: string[]): CoverageReport {
  const expected = new Set(ids);
  const found = new Map<string, 'section' | 'excluded'>();
  const unknown = new Set<string>();
  let inExcluded = false;
  for (const line of output.split('\n')) {
    if (/^##\s/.test(line)) inExcluded = /EXCLUDED/i.test(line);
    for (const m of line.matchAll(TAG_RE)) {
      const id = m[1];
      if (!expected.has(id)) { unknown.add(id); continue; }
      // A section placement wins over an EXCLUDED mention (e.g. "duplicate" of something kept).
      if (!found.has(id) || (found.get(id) === 'excluded' && !inExcluded)) found.set(id, inExcluded ? 'excluded' : 'section');
    }
  }
  return { expected: ids.length, found, missing: ids.filter(id => !found.has(id)), unknown: [...unknown] };
}

/** Recovery request: same system prompt (same rules/format), user message lists only the missing items. */
export function recoveryPrompt(base: DigestPrompt, missing: Item[]): DigestPrompt {
  const user = `RECOVERY PASS — your previous digest for this run did not account for the ${missing.length} FEED item(s) below (their id tags never appeared).
For EACH item: output exactly one bullet in the digest's normal format, ending with its [#id] tag, under the ## header of the section it belongs in (use the exact headers from REQUIRED HEADER ORDER / the OUTPUT list). If an item is a genuine duplicate/stale/unverified/spam/filler item, list it under ${EXCLUDED_HEADER} with its reason instead.
For this response ONLY, ignore the rule that every required header must appear: output ONLY the headers that receive at least one of these items, then their bullets. No other sections, no preamble, no closing remarks.

MISSING FEED ITEMS (JSON) — ${missing.length} items:
${JSON.stringify(missing)}`;
  const geminiBody: GeminiBody = structuredClone(base.geminiBody);
  geminiBody.contents[0].parts[0].text = user;
  return { ...base, user, geminiBody };
}

/** Split Markdown into [header, bodyLines][] (header '' = preamble before the first ##). */
function sections(md: string): [string, string[]][] {
  const out: [string, string[]][] = [['', []]];
  for (const line of md.split('\n')) {
    if (/^##\s/.test(line)) out.push([line.trim(), []]);
    else out[out.length - 1][1].push(line);
  }
  return out;
}

const headerKey = (h: string) => h.replace(/^##\s*/, '').replace(/[^\p{L}\p{N}&]+/gu, ' ').trim().toLowerCase();

/** Merge recovery bullets into the matching sections of the digest. Unmatched headers → Everything Else. */
export function mergeRecovery(digest: string, recovery: string): string {
  const doc = sections(digest);
  const findOrCreate = (header: string): string[] => {
    const key = headerKey(header);
    const hit = doc.find(([h]) => h && headerKey(h) === key);
    if (hit) return hit[1];
    const fallbackKey = headerKey(header).includes('excluded') ? headerKey(EXCLUDED_HEADER) : headerKey(EVERYTHING_ELSE_HEADER);
    const fb = doc.find(([h]) => h && headerKey(h) === fallbackKey);
    if (fb) return fb[1];
    // Create the section just before EXCLUDED (or at the end).
    const exIdx = doc.findIndex(([h]) => /EXCLUDED/i.test(h));
    const created: [string, string[]] = [fallbackKey.includes('excluded') ? EXCLUDED_HEADER : EVERYTHING_ELSE_HEADER, []];
    if (exIdx >= 0 && !created[0].includes('EXCLUDED')) doc.splice(exIdx, 0, created); else doc.push(created);
    return created[1];
  };

  for (const [header, lines] of sections(recovery)) {
    const bullets = lines.filter(l => l.trim().startsWith('-') || (l.trim() && !/^_.*_$/.test(l.trim())));
    if (!bullets.some(b => HAS_TAG.test(b))) continue;
    const target = findOrCreate(header || EVERYTHING_ELSE_HEADER);
    // Drop placeholder lines like "_Nothing outside the above sections._" / "EXCLUDED: none".
    for (let i = target.length - 1; i >= 0; i--) {
      if (/^_.*_$/.test(target[i].trim()) || /^EXCLUDED:\s*none\.?$/i.test(target[i].trim())) target.splice(i, 1);
    }
    while (target.length && !target[target.length - 1].trim()) target.pop();
    target.push(...bullets, '');
  }
  return doc.map(([h, body]) => (h ? [h, ...body] : body).join('\n')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Last resort: list still-missing items deterministically under Everything Else (no LLM summary). */
export function forcePlace(digest: string, items: Item[]): string {
  if (!items.length) return digest;
  const bullets = items.map(i => {
    const head = i.link ? `[**${i.title}**](${i.link})` : `**${i.title}**`;
    return `- ${head} *(${i.source})* [#${i.id}]`;
  }).join('\n');
  return mergeRecovery(digest, `${EVERYTHING_ELSE_HEADER}\n${bullets}`);
}

const KW_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'about', 'after', 'over', 'your', 'reason', 'https', 'http', 'www', 'com']);
const kw = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !KW_STOP.has(w)));

/** How much of a bullet line's wording comes from this item (title + URL slug + source). */
function lineMatchesItem(line: string, item: Item): boolean {
  const text = line.replace(/\]\([^)]*\)/g, ']').replace(/—\s*reason:.*$/i, '');
  const words = kw(text);
  if (words.size < 3) return false;
  let slug = '';
  try { slug = new URL(item.link).pathname.replace(/[-_/]+/g, ' '); } catch { /* no link */ }
  const itemWords = kw(`${item.title} ${slug} ${item.source}`);
  let shared = 0;
  for (const w of words) if (itemWords.has(w)) shared++;
  return shared / words.size >= 0.7;
}

/**
 * Before merging recovered items: drop UNTAGGED bullets anywhere in the digest that describe the
 * same items (the model often mentions an item without its tag — most often in the EXCLUDED
 * ledger — which the diff can't see, so the recovered copy would otherwise appear twice).
 */
export function removeUntaggedMentions(digest: string, items: Item[]): { digest: string; removed: number } {
  let removed = 0;
  const kept = digest.split('\n').filter(line => {
    if (!/^\s*-\s/.test(line) || HAS_TAG.test(line)) return true;
    if (items.some(it => lineMatchesItem(line, it))) { removed++; return false; }
    return true;
  });
  return { digest: kept.join('\n'), removed };
}

/** Remove id tags before delivery. */
export const stripTags = (md: string) => md.replace(/\s*\[#N\d{3,}\]/g, '');

/** Removes every ## section whose header matches (header through the next ## header or the end). */
export function stripSections(md: string, header: RegExp): string {
  const out: string[] = [];
  let skipping = false;
  for (const line of md.split('\n')) {
    if (/^##\s/.test(line)) skipping = header.test(line);
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n+(?:---+\s*)?$/, '\n');
}

export const stripExcluded = (md: string) => stripSections(md, /EXCLUDED/i);
export const stripEverythingElse = (md: string) => stripSections(md, /Everything Else/i);

/** What gets delivered: the saved digest minus the sections Format says to hide. */
export function forDelivery(md: string, format: { showExcluded: boolean; showEverythingElse: boolean }): string {
  let out = md;
  if (!format.showEverythingElse) out = stripEverythingElse(out);
  if (!format.showExcluded) out = stripExcluded(out);
  return out;
}
