// Big digests are written one topic per AI call (Zion, 2026-10-16): one call can't write ~560 stories
// (Gemini hit its output limit and looped). This file plans the calls and stitches their answers; write.ts
// runs them. Spec: docs/superpowers/specs/2026-10-16-per-topic-digests-design.md.
import { TOPICS } from '../catalog/index.js';
import type { Config } from '../config/schema.js';
import { headerKey, plainBullet, sections } from './coverage/coverage.js';
import type { Item } from './types.js';

/** Section headers exactly as Build LLM Payload writes them (tests/split.test.ts checks they still match). */
export const SECTION_HEADERS: Record<string, string> = {
  'US Politics': '## 🏛️ US Politics',
  'World News': '## 🌍 World News',
  'Business & Finance': '## 💼 Business & Finance',
  'AI & LLMs': '## 🤖 AI & LLMs',
  'Gaming': '## 🎮 Gaming',
  'Tech & Hardware': '## 🖥️ Tech & Hardware',
  'TV & Movies': '## 🎬 TV & Movies',
  'Anime': '## 🎌 Anime',
  'Animation': '## 🎨 Animation',
  'Science & Space': '## 🔭 Science & Space',
  'Health': '## 🩺 Health',
  'Security': '## 🔒 Security',
  'Comics': '## 📚 Comics',
  'Custom Feeds': '## 📡 Custom Feeds',
  'Notable Trends': '## 🔮 Notable Trends',
  'Blindspot Analysis': '## 👁️ Blindspot Analysis',
  'Leaks & Rumors': '## 🕵️ Leaks & Rumors',
};

export interface CallPlan {
  /** The topics this call writes: one, or every enabled topic that has no feed stories (searches only). */
  topics: string[];
  items: Item[];
}

/**
 * null = one call for everything (up to `limit` stories, as before). Otherwise one call per topic that has
 * stories, in the configured section order, plus one call for enabled topics that only have searches.
 */
export function planCalls(items: Item[], config: Config, limit: number): CallPlan[] | null {
  if (items.length <= limit) return null;
  const byTopic = new Map<string, Item[]>();
  for (const i of items) {
    if (!byTopic.has(i.category)) byTopic.set(i.category, []);
    byTopic.get(i.category)!.push(i);
  }
  const plans: CallPlan[] = [];
  const searchOnly: string[] = [];
  for (const topic of new Set([...config.format.sectionOrder, ...TOPICS, ...byTopic.keys()])) {
    const got = byTopic.get(topic);
    if (got?.length) plans.push({ topics: [topic], items: got });
    else if (topic !== 'Custom Feeds' && TOPICS.includes(topic) && config.topics[topic] !== false) searchOnly.push(topic);
  }
  if (searchOnly.length) plans.push({ topics: searchOnly, items: [] });
  return plans;
}

/** The run's config with only this call's topics on (their searches and rules follow), custom feeds only for the Custom Feeds call. */
export function callConfig(config: Config, plan: CallPlan): Config {
  const topics = Object.fromEntries(Object.keys(config.topics).map(t => [t, plan.topics.includes(t)]));
  const customSources = plan.topics.includes('Custom Feeds') ? config.customSources : { rss: [], youtube: [], xcancel: [] };
  return { ...config, topics, customSources };
}

const placeholder = (l: string) => /^_.*_$/.test(l.trim()) || /^EXCLUDED:\s*none\.?$/i.test(l.trim());
const trimBlank = (lines: string[]) => {
  let a = 0, b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
};
/**
 * One digest from the per-topic answers. Sections with the same header are merged, in this order: Story
 * Updates, the topics in `order` (the configured section order; a search-only topic's call comes last, its
 * section must not), any other section in answer order, Everything Else, EXCLUDED. A placeholder line
 * ("_Nothing outside…_", "EXCLUDED: none") is kept only when no answer had anything for that section. Lines
 * before the first header (e.g. a truncation banner) are kept once each, at the top.
 */
export function stitch(answers: string[], order: string[] = []): string {
  const position = new Map(order.map((t, i) => [headerKey(SECTION_HEADERS[t] ?? `## ${t}`), i]));
  const rank = (header: string): [number, number] => {
    if (/story updates/i.test(header)) return [0, 0];
    if (/everything else/i.test(header)) return [3, 0];
    if (/EXCLUDED/i.test(header)) return [4, 0];
    const at = position.get(headerKey(header));
    return at === undefined ? [2, 0] : [1, at];
  };
  const preamble: string[] = [];
  const merged = new Map<string, { header: string; content: string[]; fallback: string[] }>();
  for (const answer of answers) {
    for (const [header, body] of sections(answer)) {
      if (!header) {
        for (const l of body) if (l.trim() && !preamble.includes(l)) preamble.push(l);
        continue;
      }
      const key = headerKey(header);
      if (!merged.has(key)) merged.set(key, { header, content: [], fallback: [] });
      const s = merged.get(key)!;
      const kept = trimBlank(body.filter(l => !placeholder(l)));
      if (kept.length) {
        if (s.content.length) s.content.push('');
        s.content.push(...kept);
      } else if (!s.fallback.length) {
        s.fallback.push(...trimBlank(body));
      }
    }
  }
  const ordered = [...merged.values()].sort((a, b) => { const [ga, ia] = rank(a.header), [gb, ib] = rank(b.header); return ga - gb || ia - ib; });
  const body = ordered.map(s => [s.header, ...(s.content.length ? s.content : s.fallback)].join('\n')).join('\n\n');
  return (preamble.length ? `${preamble.join('\n')}\n\n${body}` : body).trim();
}

/**
 * The part of this morning's digest a nightly topic call needs: the sections for its own topics. Each call
 * can then write Story Updates (and spot stale stories) for its topic; '' when the morning had none of them.
 */
export function morningSlice(morning: string, topics: string[]): string {
  const keys = new Set(topics.map(t => headerKey(SECTION_HEADERS[t] ?? `## ${t}`)));
  return sections(morning)
    .filter(([header]) => header && keys.has(headerKey(header)))
    .map(([header, body]) => [header, ...body].join('\n').trim())
    .join('\n\n');
}

/** A call the AI couldn't write: its stories as plain headlines under their own topic headers. */
export function plainSections(plan: CallPlan): string {
  return plan.topics
    .map(t => {
      const items = plan.items.filter(i => i.category === t);
      return items.length ? [SECTION_HEADERS[t] ?? `## ${t}`, ...items.map(plainBullet)].join('\n') : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/** The note at the top of a digest when some topics couldn't be written: which, and why (explain.ts wording). */
export function failureNote(topics: string[], reason: string): string {
  const why = reason.split('\n').filter(l => l.startsWith('• '));
  return [`⚠️ **Some topics couldn't be written: ${topics.join(', ')}.** Their headlines are listed without summaries.`, ...why].join('\n');
}
