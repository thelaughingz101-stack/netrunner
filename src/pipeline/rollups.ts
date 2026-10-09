// Ports of n8n "Weekly Recap Code" / "Monthly Recap Code". Prompt wording, sections, and the
// generationConfig are verbatim. Fix (CHANGES_FROM_N8N.md): n8n listed digest FILE PATHS the model
// could never open, so rollups had no real content; these give it the saved digests' text instead.
import { DateTime } from 'luxon';
import { digestsBetween, type DigestRow } from '../digests.js';
import { storiesBetween } from '../stories/tracker.js';
import { promptFromGeminiBody, type DigestPrompt, type GeminiBody } from './prompt/index.js';

/** Full digests if they fit; otherwise headlines only (section headers + bullet headlines). */
export function digestCorpus(digests: DigestRow[], maxChars: number): { text: string; mode: 'full' | 'headlines' } {
  const block = (d: DigestRow, body: string) => `### ${d.date} — ${d.mode}\n${body}`;
  const full = digests.map(d => block(d, d.content)).join('\n\n');
  if (full.length <= maxChars) return { text: full, mode: 'full' };
  const headlinesOnly = (md: string) => md.split('\n')
    .filter(l => /^##\s/.test(l) || /^-\s/.test(l))
    .map(l => (/^-\s/.test(l) ? l.split(' — ')[0] : l))
    .join('\n');
  return { text: digests.map(d => block(d, headlinesOnly(d.content))).join('\n\n').slice(0, maxChars), mode: 'headlines' };
}

const gemini = (system: string, user: string): GeminiBody => ({
  systemInstruction: { parts: [{ text: system }] },
  contents: [{ role: 'user', parts: [{ text: user }] }],
  tools: [{ googleSearch: {} }],
  generationConfig: { maxOutputTokens: 8192, temperature: 0.1, topP: 0.9 },
});

export function weeklyPrompt(now: Date, timezone: string, maxChars = 400_000): { prompt: DigestPrompt; digestCount: number; corpusMode: string } {
  const today = DateTime.fromJSDate(now).setZone(timezone).startOf('day');
  const dates: string[] = [];
  for (let i = 6; i >= 1; i--) dates.push(today.minus({ days: i }).toISODate()!);
  const weekDeveloping = storiesBetween(dates[0], today.toISODate()!)
    .filter(s => s.appearances >= 2).slice(0, 15)
    .map(s => `- ${s.title} (${s.appearances} days)`);
  const weekLabel = dates[0] + ' – ' + dates[dates.length - 1];
  const digests = digestsBetween(dates[0], dates[dates.length - 1]);
  const corpus = digestCorpus(digests, maxChars);

  const rollupPrompt = `You are producing a WEEKLY ROLLUP digest for the week of ${weekLabel}.

DEVELOPING STORIES THIS WEEK (appeared 2+ days):
${weekDeveloping.length > 0 ? weekDeveloping.join('\n') : '(none tracked)'}

DIGESTS FROM THIS WEEK (${digests.length} saved digests, oldest first${corpus.mode === 'headlines' ? ' — headlines only, full text too long' : ''}):
${digests.length ? corpus.text : '(no saved digests this week — rely on verified live search only)'}

Produce a clean weekly summary with these sections:

## 📰 WEEK IN REVIEW — ${weekLabel}

## 🔥 Top Stories of the Week
The 5-7 biggest verified stories across all categories this week. Each with a 2-3 sentence summary and source.

## 📈 Developing Stories
Stories that ran across multiple days — what started, how they developed, where they stand now.

## 🎮 Gaming Week
Key gaming announcements, releases, and news from the week.

## 🤖 AI & Tech Week
Notable AI and technology developments from the week.

## 🎬 Entertainment Week
Film, TV, anime, and animation highlights.

## 🇺🇸 Politics & World Week
Major political and world news that affected the US.

## 🕵️ Leaks & Rumors Worth Watching
Credible leaks from the week still unconfirmed — keep watching.

FORMAT: Clean Markdown. ## headers. Each item: - [**Headline**](url) — summary. *(source)*
No preamble. No closing remarks. Just the rollup.`;

  const body = gemini('You are a weekly news digest agent. Summarize the week accurately and concisely from verified sources only. Never fabricate.', rollupPrompt);
  return { prompt: promptFromGeminiBody('weekly', body), digestCount: digests.length, corpusMode: corpus.mode };
}

export function monthlyPrompt(now: Date, timezone: string, maxChars = 400_000): { prompt: DigestPrompt; digestCount: number; corpusMode: string } {
  const today = DateTime.fromJSDate(now).setZone(timezone).startOf('day');
  const first = today.startOf('month').toISODate()!;
  const monthName = today.toLocaleString({ month: 'long', year: 'numeric' }, { locale: 'en-US' });
  const monthStories = storiesBetween(first, today.toISODate()!).filter(s => s.firstSeen >= first);
  const topStories = monthStories.slice(0, 20).map(s => `- ${s.title} (${s.appearances} days, ${s.firstSeen} → ${s.lastSeen})`);
  const digests = digestsBetween(first, today.toISODate()!);
  const morning = digests.filter(d => d.mode === 'morning').length;
  const corpus = digestCorpus(digests, maxChars);

  const recapPrompt = `You are producing a MONTHLY RECAP for ${monthName}.

TOP RECURRING STORIES THIS MONTH (by days seen):
${topStories.length > 0 ? topStories.join('\n') : '(none tracked)'}

TOTAL DIGEST FILES THIS MONTH: ${digests.length} (${morning} morning + ${digests.length - morning} nightly)

DIGESTS FROM THIS MONTH (oldest first${corpus.mode === 'headlines' ? ' — headlines only, full text too long' : ''}):
${digests.length ? corpus.text : '(no saved digests this month — rely on verified live search only)'}

Produce a clean monthly recap with these sections:

## 📅 MONTHLY RECAP — ${monthName}

## 🏆 Stories That Defined the Month
The 5-7 biggest verified stories that shaped this month. Multi-day stories get priority.

## 📊 Month by Category
One paragraph per active category summarizing the month's key developments:
- Gaming | AI & Tech | Entertainment | Politics | Science & Space

## 🔍 Stories Still Developing
Stories from this month with unresolved threads — what to watch next month.

## 🏁 Month in Numbers
- Total digests published
- Most active news category (by story count)
- Biggest single-day story

FORMAT: Clean Markdown. ## headers. Each item: - [**Headline**](url) — summary. *(source)*
No preamble. No closing remarks. Just the recap.`;

  const body = gemini('You are a monthly news recap agent. Summarize the month accurately from verified sources only. Never fabricate.', recapPrompt);
  return { prompt: promptFromGeminiBody('monthly', body), digestCount: digests.length, corpusMode: corpus.mode };
}
