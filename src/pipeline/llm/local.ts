// The digest a local model (Ollama) writes. A small model can't follow the full digest prompt or read 150
// stories at once (smollm2:1.7b reads 8,192 tokens; the prompt alone is about 6,000), and asked for numbered
// summaries of 8 stories it mostly copied the headlines. So NetRunner builds the digest itself: sections,
// headlines, links and outlets come straight from the feeds, and the model only shortens each story's text,
// one story per request. Measured 2026-10-22 on a Ryzen 7 5700U laptop (CPU only): about 3 s a story, and only
// about a third of a 12-hour Light digest needs it (the rest have no text, or one short sentence used as is).
import { TOPICS } from '../../catalog/index.js';
import type { Config } from '../../config/schema.js';
import { EVERYTHING_ELSE_HEADER, EXCLUDED_HEADER } from '../coverage/coverage.js';
import { SECTION_HEADERS } from '../split.js';
import type { Item } from '../types.js';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
/** One request to the local model: its answer, or a throw. */
export type Chat = (messages: ChatMessage[], maxTokens: number, signal: AbortSignal) => Promise<string>;

/** How long a summary may be, from Format → Summary length (a small model can't do 3–5 good sentences). */
export interface Limit { sentences: number; words: number; maxTokens: number }
export const limitFor = (summaryLength: string): Limit =>
  summaryLength === '1' ? { sentences: 1, words: 32, maxTokens: 70 }
  : summaryLength === 'full' ? { sentences: 3, words: 75, maxTokens: 170 }
  : { sentences: 2, words: 50, maxTokens: 110 };

export interface LocalStats {
  model: string;
  stories: number;
  /** Shortened by the model. */
  summarized: number;
  /** The feed's own text was short enough to use as is. */
  feedText: number;
  /** No usable text: listed by headline. */
  headlineOnly: number;
  /** The model's answer failed the checks (or it didn't answer): the feed's first sentence instead. */
  fallback: number;
  /** Time spent waiting on the model. */
  modelMs: number;
  /** Why the model stopped being asked before the end, if it did. */
  stopped?: string;
}

// ── Story text ──────────────────────────────────────────────────────────────────────────────────────────

const ABBREV = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Rep|Sen|Gov|Gen|Lt|Col|Sgt|St|Jr|Sr|Inc|Corp|Co|Ltd|vs|No|Vol|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|U\.K|U\.N|E\.U|a\.m|p\.m)|\b[A-Z])\.$/;
const ENDS_SENTENCE = /[.!?]["”’)\]]?$/;

/** The text's sentences: `done` are complete, `rest` is a cut-off tail (feeds trim their text mid-sentence). */
export function sentences(text: string): { done: string[]; rest: string } {
  const out: string[] = [];
  for (const p of text.trim().split(/(?<=[.!?]["”’)\]]?)\s+(?=["“‘(\[]?[A-Z0-9])/)) {
    if (out.length && ABBREV.test(out[out.length - 1])) out[out.length - 1] += ` ${p}`;
    else if (p) out.push(p);
  }
  const last = out.at(-1) ?? '';
  return ENDS_SENTENCE.test(last) ? { done: out, rest: '' } : { done: out.slice(0, -1), rest: last };
}

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', deg: '°', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
/** "&#038;", "&mdash;", "&deg;": feeds leave HTML entities in titles and text. */
export const decodeEntities = (s: string) => s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m);

/** The feed's text without what feeds tack on ("The post … appeared first on …", "[…]", "Read more", Reddit's
 *  "submitted by /u/… [link] [comments]", bare links), entities decoded, whitespace collapsed, and without a
 *  leading copy of the headline. Seen in the first local digest (2026-10-22). */
export function storyText(item: Item): string {
  let t = decodeEntities(item.summary || '').replace(/\s+/g, ' ')
    .replace(/\s*The post .{0,300}? appeared first on .{0,160}$/i, '')
    .replace(/\s*submitted by \/u\/\S+.*$/i, '')
    .replace(/\s*(?:\[(?:…|\.\.\.)\]|(?:Continue reading|Read more|Read the full story)\b.*)$/i, '')
    .replace(/\s*\bhttps?:\/\/\S+/g, '')
    .trim();
  const title = decodeEntities(item.title).trim();
  if (title.length > 10 && t.toLowerCase().startsWith(title.toLowerCase())) t = t.slice(title.length).replace(/^[\s:.,;—–-]+/, '');
  return t.trim();
}

const STOP = new Set(('the a an and or of to in on for with at by from as is are was were be been being has have had it its this that these those '
  + 'their they them he she his her him will would can could said says say new about after before over into than more most also not but which who whom '
  + 'what when where while why how all any some our out one just').split(' '));
const contentWords = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => w.length > 2 && !STOP.has(w));
/** Words that share their first five letters count as the same word ("libraries"/"library", "detected"/"detecting"). */
const stem = (w: string) => (w.length <= 5 ? w.replace(/s$/, '') : w.slice(0, 5));
const stems = (s: string) => new Set(contentWords(s).map(stem));

/** Text that only repeats the headline adds nothing under it. */
function onlyRepeats(text: string, title: string): boolean {
  const t = stems(title);
  const w = contentWords(text);
  return w.length > 0 && w.filter(x => t.has(stem(x))).length / w.length >= 0.8;
}

export type How = 'model' | 'feed' | 'headline';

/** What a story needs: the model, its own text as is (short and complete), or nothing (no usable text). */
export function howToWrite(item: Item, text: string, limit: Limit): How {
  if (text.length < 40 || onlyRepeats(text, item.title)) return 'headline';
  const { done, rest } = sentences(text);
  if (!rest && done.length <= limit.sentences && wordCount(text) <= limit.words) return 'feed';
  return 'model';
}

const clip = (s: string, words: number) => {
  const w = s.trim().split(/\s+/);
  return w.length <= words ? s.trim() : `${w.slice(0, words).join(' ').replace(/[,;:—–-]+$/, '')}…`;
};

/** The story's own opening sentences, within the length setting: used when the model's answer can't be. */
export function fromFeed(text: string, limit: Limit): string {
  const { done, rest } = sentences(text);
  const out: string[] = [];
  for (const s of done) {
    if (out.length >= limit.sentences || wordCount([...out, s].join(' ')) > limit.words) break;
    out.push(s);
  }
  if (out.length) return out.join(' ');
  // No complete sentence fits: the first one cut short, or the cut-off text, marked as cut.
  return done[0] ? clip(done[0], limit.words) : `${clip(rest, limit.words).replace(/…$/, '')}…`;
}

// ── The model's part ────────────────────────────────────────────────────────────────────────────────────

const SHOTS: [ChatMessage, ChatMessage][] = [
  [{ role: 'user', content: 'Headline: Nintendo Switch 2 sales pass 20 million\nSource: IGN\nArticle text: Nintendo said Tuesday the console sold 20.1 million units through September, ahead of the original Switch at the same point, and raised its yearly forecast to 25 million. The company also confirmed a new Zelda game for 2027.' },
    { role: 'assistant', content: 'Nintendo sold 20.1 million Switch 2 consoles through September, raised its yearly forecast to 25 million and confirmed a new Zelda game for 2027.' }],
  // A teaser with little in it: stay with what it says rather than filling in.
  [{ role: 'user', content: "Headline: You won't believe what Valve just did\nSource: PC Gamer\nArticle text: The Half-Life studio has a surprise for Steam users this week, and it involves your library." },
    { role: 'assistant', content: 'Valve has a surprise for Steam users this week that involves their game libraries.' }],
];

const LENGTH = ['one sentence', 'one or two sentences', 'two or three sentences'];

/** The request for one story. Same system text and examples every time, so Ollama reuses them (prompt cache). */
export function storyMessages(item: Item, text: string, limit: Limit, language = 'English'): ChatMessage[] {
  const lang = /^english$/i.test(language.trim()) ? '' : ` Write in ${language}.`;
  return [
    { role: 'system', content: `You shorten news articles into ${LENGTH[limit.sentences - 1]}. Use only the article text: copy names and numbers exactly, and add nothing that is not in the text. No opinions, no "the article says".${lang}` },
    ...SHOTS.flat(),
    { role: 'user', content: `Headline: ${decodeEntities(item.title)}\nSource: ${item.source}\nArticle text: ${text}` },
  ];
}

/**
 * The model's answer, tidied and cut to the length setting, or null when it can't be trusted: a refusal, a number
 * the story doesn't have, or too many words the story doesn't use (on 2026-10-22 smollm2 turned "I see technology
 * as a tool" into "not a replacement for human creativity"). Cut first: small models add a made-up last sentence.
 */
export function checkSummary(answer: string, item: Item, text: string, limit: Limit): string | null {
  let a = answer.replace(/<think>[\s\S]*?<\/think>/g, '').trim().split(/\n\s*\n/)[0] ?? '';
  a = a.replace(/^\s*(?:[-*•]\s+|summary\s*:\s*|here(?:'s| is) (?:a |the )?(?:short |one-sentence )?summary\s*:?\s*)/i, '').replace(/\s+/g, ' ').trim();
  a = a.replace(/^["“](.*)["”]$/, '$1').trim();
  if (a.length < 20) return null;
  if (/\b(?:I'm sorry|I am sorry|I cannot|I can't|as an AI|language model)\b/i.test(a)) return null;
  const { done, rest } = sentences(a);
  const kept = (done.length ? done.slice(0, limit.sentences) : [rest]).join(' ');
  const source = `${item.title} ${text}`;
  // Whole numbers: "5" isn't in a story just because "2025" is.
  const numbers = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map(n => n.replace(/[.,]$/, '').replace(/,/g, ''));
  const sourceNumbers = new Set(numbers(source));
  if (numbers(kept).some(n => !sourceNumbers.has(n))) return null;
  const known = stems(`${source} ${item.source}`);
  const w = contentWords(kept);
  const novel = w.filter(x => !known.has(stem(x))).length;
  if (novel >= 3 && novel / w.length > 0.25) return null;
  if (onlyRepeats(kept, item.title)) return null;
  return ENDS_SENTENCE.test(kept) ? kept : `${kept}.`;
}

// ── The digest ──────────────────────────────────────────────────────────────────────────────────────────

/** A merged story names each outlet once ("GBAtemp, GBAtemp" came from two of its feeds). */
const outlets = (source: string) => [...new Set(source.split(', ').map(s => s.trim()).filter(Boolean))].join(', ');

const bullet = (it: Item, summary: string) => {
  const title = decodeEntities(it.title).trim();
  return `- ${it.link ? `[**${title}**](${it.link})` : `**${title}**`}${summary ? ` — ${summary}` : ''} *(${outlets(it.source)})* [#${it.id}]`;
};

/** Stories under their topic headers, in the configured section order. A recovery answer has only those
 *  sections; a digest also gets the notes on top and the closing sections every digest has. */
export function assemble(items: Item[], summaries: Map<string, string>, config: Config, opts: { notes?: string[]; recovery?: boolean } = {}): string {
  const order = [...new Set([...config.format.sectionOrder, ...TOPICS, ...items.map(i => i.category)])];
  const other: string[] = [];
  const parts: string[] = [];
  for (const topic of order) {
    const got = items.filter(i => i.category === topic);
    if (!got.length) continue;
    const lines = got.map(i => bullet(i, summaries.get(i.id!) ?? ''));
    if (SECTION_HEADERS[topic]) parts.push([SECTION_HEADERS[topic], ...lines].join('\n'));
    else other.push(...lines);
  }
  if (opts.recovery) return [...parts, ...(other.length ? [[EVERYTHING_ELSE_HEADER, ...other].join('\n')] : [])].join('\n\n');
  return [
    ...(opts.notes?.length ? [opts.notes.join('\n')] : []),
    ...parts,
    [EVERYTHING_ELSE_HEADER, ...(other.length ? other : ['_Nothing outside the above sections._'])].join('\n'),
    `${EXCLUDED_HEADER}\nEXCLUDED: none`,
  ].join('\n\n');
}

/** Requests in a row that can fail before the model stops being asked (the rest use the feeds' own text). */
const MAX_FAILURES_IN_A_ROW = 3;

export interface LocalJob {
  items: Item[];
  config: Config;
  model: string;
  chat: Chat;
  /** The whole job's time: when it runs out, the stories not yet done use their feed text. */
  signal: AbortSignal;
  /** One story's request: a model this slow is skipped for that story. */
  perStoryMs: number;
  notes?: string[];
  recovery?: boolean;
  onProgress?: (done: number, total: number) => void;
}

/** Writes the stories, one model request at a time. Never throws for the model's sake: a story it can't
 *  write keeps its feed text, so the digest always has every story. */
export async function writeLocally(job: LocalJob): Promise<{ text: string; stats: LocalStats }> {
  const limit = limitFor(job.config.format.summaryLength);
  const stats: LocalStats = { model: job.model, stories: job.items.length, summarized: 0, feedText: 0, headlineOnly: 0, fallback: 0, modelMs: 0 };
  const summaries = new Map<string, string>();
  const todo: { item: Item; text: string }[] = [];
  for (const item of job.items) {
    const text = storyText(item);
    const how = howToWrite(item, text, limit);
    if (how === 'headline') stats.headlineOnly++;
    else if (how === 'feed') { stats.feedText++; summaries.set(item.id!, text); }
    else todo.push({ item, text });
  }

  let failures = 0;
  for (const [n, { item, text }] of todo.entries()) {
    job.onProgress?.(n, todo.length);
    let summary: string | null = null;
    if (!stats.stopped) {
      if (job.signal.aborted) stats.stopped = 'ran out of time';
      else {
        const t0 = Date.now();
        try {
          const answer = await job.chat(storyMessages(item, text, limit, job.config.format.language), limit.maxTokens,
            AbortSignal.any([job.signal, AbortSignal.timeout(job.perStoryMs)]));
          summary = checkSummary(answer, item, text, limit);
          failures = 0;
        } catch (e) {
          if (job.signal.aborted) stats.stopped = 'ran out of time';
          else if (++failures >= MAX_FAILURES_IN_A_ROW) stats.stopped = `stopped answering (${(e as Error).message.slice(0, 120)})`;
        }
        stats.modelMs += Date.now() - t0;
      }
    }
    if (summary) stats.summarized++; else stats.fallback++;
    summaries.set(item.id!, summary ?? fromFeed(text, limit));
  }
  job.onProgress?.(todo.length, todo.length);
  return { text: assemble(job.items, summaries, job.config, { notes: job.notes, recovery: job.recovery }), stats };
}

/** Topics that are on but got nothing from the feeds in this request: the online AIs would search the web. */
export function feedlessTopics(items: Item[], config: Config): string[] {
  const have = new Set(items.map(i => i.category));
  return TOPICS.filter(t => t !== 'Custom Feeds' && config.topics[t] !== false && !have.has(t));
}
