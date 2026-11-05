import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '../src/config/schema.js';
import { assemble, checkSummary, feedlessTopics, fromFeed, howToWrite, limitFor, sentences, storyMessages, storyText, writeLocally, type Chat } from '../src/pipeline/llm/local.js';
import type { Item } from '../src/pipeline/types.js';

const item = (p: Partial<Item>): Item => ({ mode: 'morning', source: 'Deadline', category: 'TV & Movies', title: 'A headline', link: 'https://x.dev/a', published: null, summary: '', id: 'N001', ...p });
const one = limitFor('1');
const two = limitFor('2-3');

// Real feed text from the 2026-10-22 test run (smollm2:1.7b-instruct-q4_K_M on a laptop CPU).
const KNIGHT = item({
  title: '‘Wildwood’ Director Travis Knight on AI: ‘An Amazing Piece of Technology’ But ‘I’m Not Embracing It at All’',
  summary: '“Wildwood” director Travis Knight is weighing in on Hollywood’s use of AI. “I’m not embracing it at all,” Knight told me Wednesday night at AFI Fest’s opening night U.S. premiere of “Wildwood.” “I see technology as a tool, and we use technology at Laika. A pen […]',
});
const RAILWAY = item({ source: 'BleepingComputer', category: 'Security', title: 'Railway warns devs to rotate secrets after potential breach',
  summary: 'Cloud platform Railway published an urgent warning to users after detecting suspicious activity on its systems that store customer environment variables earlier this week. [...]' });

describe('the story text a local model gets', () => {
  it('drops what feeds tack on, and a leading copy of the headline', () => {
    expect(storyText(item({ title: 'Toy Story 5 Stopped Production', summary: 'Pixar halted production for two weeks. The post Toy Story 5 Stopped Production appeared first on ComingSoon.net - Movie Trailers.' })))
      .toBe('Pixar halted production for two weeks.');
    expect(storyText(RAILWAY)).toMatch(/environment variables earlier this week\.$/);
    expect(storyText(item({ title: 'Exclusive Look: Secret Wars', summary: 'Exclusive Look: Secret Wars, the next entry in the Marvel Age series' }))).toBe('the next entry in the Marvel Age series');
    // From the first local digest: Reddit's footer, a bare link in a Bluesky post, HTML entities.
    expect(storyText(item({ title: 'CDC denies approval for measles test', summary: 'The CDC said no. submitted by /u/AudibleNod to r/news [link] [comments]' }))).toBe('The CDC said no.');
    expect(storyText(item({ title: 'ACE COMBAT ZERO gets its own app', summary: 'https://store.steampowered.com/app/5370600/ Users no longer need AC8 to play it.' }))).toBe('Users no longer need AC8 to play it.');
    expect(storyText(item({ title: 'M 7.0 quake', summary: 'Location 32.381&deg;N &mdash; Marvel &#038; DC' }))).toBe('Location 32.381°N — Marvel & DC');
  });

  it('splits sentences, not abbreviations or initials, and keeps a cut-off tail apart', () => {
    expect(sentences('Rep. Alexandria Ocasio-Cortez spoke in the U.S. Senate. Allyson K. Thompson asked for a delay. The trial was set for Jan')).toEqual({
      done: ['Rep. Alexandria Ocasio-Cortez spoke in the U.S. Senate.', 'Allyson K. Thompson asked for a delay.'], rest: 'The trial was set for Jan',
    });
  });

  it('asks the model only when there is something to shorten', () => {
    expect(howToWrite(item({ title: 'Big news' }), '', one)).toBe('headline');
    expect(howToWrite(item({ title: 'Railway warns devs to rotate secrets' }), 'Railway warns devs to rotate their secrets.', one)).toBe('headline');
    expect(howToWrite(item({}), 'Critics and audiences are in disagreement over Season 2 of The Terminal List.', one)).toBe('feed');
    expect(howToWrite(KNIGHT, storyText(KNIGHT), one)).toBe('model');
  });

  it("falls back to the story's own complete opening sentences, within the length setting", () => {
    expect(fromFeed(storyText(KNIGHT), one)).toBe('“Wildwood” director Travis Knight is weighing in on Hollywood’s use of AI.');
    expect(fromFeed('No full stop anywhere in this long cut off text that just keeps going on and on and on past the limit of words allowed here', one)).toMatch(/…$/);
  });
});

describe("checking the model's answer", () => {
  const text = storyText(KNIGHT);
  it('keeps a faithful answer, tidied and cut to the length setting', () => {
    expect(checkSummary('Summary: Travis Knight told AFI Fest he is not embracing AI, though Laika uses technology as a tool. He loves pens.', KNIGHT, text, one))
      .toBe('Travis Knight told AFI Fest he is not embracing AI, though Laika uses technology as a tool.');
    expect(checkSummary('Travis Knight says he is not embracing AI at all.', KNIGHT, text, one)).toBeNull(); // the headline, reworded
    expect(checkSummary('"Travis Knight told AFI Fest he sees technology as a tool"', KNIGHT, text, two)).toBe('Travis Knight told AFI Fest he sees technology as a tool.');
  });

  it('refuses invented words, invented numbers, refusals and a repeat of the headline', () => {
    // What smollm2 actually wrote for this story on 2026-10-22.
    expect(checkSummary("Wildwood director Travis Knight says he's not embracing AI and sees it as a tool, not a replacement for human creativity.", KNIGHT, text, one)).toBeNull();
    expect(checkSummary('Travis Knight said Laika used AI on 3 films.', KNIGHT, text, one)).toBeNull();
    // smollm2 on 2026-10-22: "after a 5-episode pickup", in a story whose only numbers were 18 and 2026.
    const fire = item({ title: '‘Line Of Fire’ Gets Full 18-Episode Season Order At NBC', summary: 'NBC has handed a full 18-episode season order to its Monday night drama hit Line of Fire, its 2025 breakout. The drama stars Peter Krause.' });
    expect(checkSummary('NBC handed a full 18-episode order to Line of Fire after a 5-episode pickup.', fire, storyText(fire), one)).toBeNull();
    expect(checkSummary("I'm sorry, I can't summarize this article.", KNIGHT, text, one)).toBeNull();
    expect(checkSummary('Railway warns devs to rotate secrets after potential breach.', RAILWAY, storyText(RAILWAY), one)).toBeNull();
  });

  it('sends the same instructions and examples every time (Ollama reuses them), then the story', () => {
    const m = storyMessages(KNIGHT, text, one);
    expect(m[0]).toMatchObject({ role: 'system', content: expect.stringContaining('into one sentence') });
    expect(m.at(-1)!.content).toBe(`Headline: ${KNIGHT.title}\nSource: Deadline\nArticle text: ${text}`);
    expect(storyMessages(RAILWAY, 'x', one).slice(0, -1)).toEqual(m.slice(0, -1));
    expect(storyMessages(KNIGHT, text, two, 'Spanish')[0].content).toMatch(/one or two sentences.*Write in Spanish\.$/);
  });
});

describe('the digest a local model writes', () => {
  const config = normalizeConfig({ format: { summaryLength: '1' } });
  const items = [
    // Two sentences: longer than the one-sentence setting, so the model shortens it.
    item({ id: 'N001', category: 'Security', source: 'BleepingComputer', title: 'Railway warns devs to rotate secrets after potential breach',
      summary: `${RAILWAY.summary.replace(' [...]', '')} The company said it changed its own keys and asked every user to do the same. [...]` }),
    item({ id: 'N002', category: 'Gaming', title: 'Patch notes', summary: '' }),
    item({ id: 'N003', category: 'Gaming', title: 'Season 2 reviews', summary: 'Critics and audiences are in disagreement over Season 2.' }),
  ];

  it('builds the sections in code: headline, link and outlet from the feed, the summary from the model, every id', async () => {
    const asked: string[] = [];
    const chat: Chat = async m => { asked.push(m.at(-1)!.content); return 'Railway told users to rotate secrets after detecting suspicious activity on its systems.'; };
    const { text, stats } = await writeLocally({ items, config, model: 'tiny', chat, signal: new AbortController().signal, perStoryMs: 1000, notes: ['🖥️ Written on this computer by tiny.'] });
    expect(asked).toHaveLength(1);
    expect(text).toBe([
      '🖥️ Written on this computer by tiny.',
      '',
      '## 🎮 Gaming',
      '- [**Patch notes**](https://x.dev/a) *(Deadline)* [#N002]',
      '- [**Season 2 reviews**](https://x.dev/a) — Critics and audiences are in disagreement over Season 2. *(Deadline)* [#N003]',
      '',
      '## 🔒 Security',
      '- [**Railway warns devs to rotate secrets after potential breach**](https://x.dev/a) — Railway told users to rotate secrets after detecting suspicious activity on its systems. *(BleepingComputer)* [#N001]',
      '',
      '## 📋 Everything Else',
      '_Nothing outside the above sections._',
      '',
      '## 🗒️ EXCLUDED',
      'EXCLUDED: none',
    ].join('\n'));
    expect(stats).toMatchObject({ stories: 3, summarized: 1, feedText: 1, headlineOnly: 1, fallback: 0 });
  });

  it('a recovery answer has only the sections with stories; a merged story names each outlet once', () => {
    expect(assemble([items[1]], new Map(), config, { recovery: true })).toBe('## 🎮 Gaming\n- [**Patch notes**](https://x.dev/a) *(Deadline)* [#N002]');
    expect(assemble([{ ...items[1], title: 'Solicits &#038; more', source: 'GBAtemp, GBAtemp, Reddit r/games' }], new Map(), config, { recovery: true }))
      .toBe('## 🎮 Gaming\n- [**Solicits & more**](https://x.dev/a) *(GBAtemp, Reddit r/games)* [#N002]');
  });

  it('keeps going when the model fails: feed text for that story, and after 3 failures in a row it stops asking', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...items[0], id: `N00${i + 1}` }));
    let calls = 0;
    const chat: Chat = async () => { calls++; throw new Error('HTTP 500'); };
    const { text, stats } = await writeLocally({ items: many, config, model: 'tiny', chat, signal: new AbortController().signal, perStoryMs: 1000 });
    expect(calls).toBe(3);
    expect(stats).toMatchObject({ summarized: 0, fallback: 5, stopped: expect.stringContaining('stopped answering') });
    for (const it of many) expect(text).toContain(`[#${it.id}]`);
    expect(text).toContain('— Cloud platform Railway published an urgent warning');
  });

  it('when the time runs out, the stories left use their feed text', async () => {
    const ctrl = new AbortController();
    const chat: Chat = async () => { ctrl.abort(); throw new Error('aborted'); };
    const { stats } = await writeLocally({ items: [items[0], { ...items[0], id: 'N009' }], config, model: 'tiny', chat, signal: ctrl.signal, perStoryMs: 1000 });
    expect(stats).toMatchObject({ fallback: 2, stopped: 'ran out of time' });
  });

  it('names the topics that got nothing from the feeds (the online AIs would search for them)', () => {
    const only = normalizeConfig({ topics: { Gaming: true, Security: true, Anime: true, 'Blindspot Analysis': true, 'Custom Feeds': true } });
    const on = (t: string) => ['Gaming', 'Security', 'Anime', 'Blindspot Analysis', 'Custom Feeds'].includes(t);
    const cfg = { ...only, topics: Object.fromEntries(Object.keys(only.topics).map(t => [t, on(t)])) };
    expect(feedlessTopics(items, cfg)).toEqual(['Anime', 'Blindspot Analysis']);
  });
});
