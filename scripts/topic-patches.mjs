// Topic-toggle patches for scripts/gen-prompts.mjs. The deployed n8n prompts ignored the Topics tab in
// several places: Build LLM Payload asked the model to web-search EVERY topic (trending X topics, market
// numbers, comics, anime…) and forced Leaks & Rumors + Blindspot into every digest; the five exporters
// hardcoded Business & Finance, Blindspot and Leaks & Rumors (Leaks twice) and had no World News.
// With only one topic enabled, the digest still came back full of other topics, mostly in Everything Else.

const SEARCH_TASKS_FN = `// Search tasks follow the topic toggles (n8n asked for every topic's searches regardless).
function searchTasks(nightly) {
  const on = t => enabledTopics[t] !== false;
  const when = nightly ? 'today' : 'overnight';
  const tasks = [];
  if (on('Notable Trends')) tasks.push('Top 10 trending X/Twitter US topics right now (search for current results, do not guess)');
  if (on('US Politics')) tasks.push(nightly ? 'Breaking US political news since this morning (verified sources only)' : 'Overnight US political news (verified sources only)');
  if (on('Business & Finance')) tasks.push(nightly ? 'How S&P 500, Nasdaq, Dow closed today (use real closing numbers)' : 'Premarket conditions today (use real numbers from a live search)');
  const announced = [];
  if (on('Gaming') || on('Media Announcements')) announced.push('game');
  if (on('TV & Movies') || on('Media Announcements')) announced.push('movie', 'TV show');
  if (on('Anime') || on('Media Announcements')) announced.push('anime');
  if (announced.length) tasks.push('Any OFFICIALLY announced ' + announced.join(', ').replace(/, ([^,]*)$/, ', or $1') + ' news ' + when + ' (press releases and official sources only)');
  if (on('Comics')) tasks.push((nightly ? 'New' : 'Upcoming') + ' comic book releases this Wednesday (NCBD) — search each publisher separately: DC Comics, Marvel Comics, Image Comics, Boom Studios, Dark Horse Comics, Dynamite Entertainment, IDW Publishing, Indie publishers. Only list issues you can verify from ComicList, AIPT, CBR, or publisher websites.');
  if (on('Science & Space')) tasks.push('Science and space discoveries or announcements ' + when + ' (NASA, Phys.org, Space.com, ESA)');
  if (on('Anime')) tasks.push('Anime news ' + when + ' (Anime News Network, Crunchyroll, Funimation, official studio sources only)');
  if (on('Animation')) tasks.push('Western animation news ' + when + ' (Adult Swim, Cartoon Network, Netflix Animation, official sources only)');
  if (on('Security')) tasks.push('Cybersecurity incidents ' + when + ' at state/federal level OR affecting a major company mentioned in this digest (Krebs on Security, TorrentFreak, verified outlets only)');
  if (on('Leaks & Rumors')) tasks.push('Gaming leaks and rumors ONLY from journalists Tom Henderson, Jeff Grubb, Jason Schreier (via their outlets / social posts) and outlets Insider Gaming, VGC, Eurogamer, IGN, Kotaku, Giant Freakin Robot, MP1st. Attribute every item. If none found, say so honestly.');
  if (on('Blindspot Analysis')) tasks.push('Blindspot Analysis: identify 2-3 stories appearing in only ONE outlet or only one political direction that other major outlets are ignoring');
  if (!tasks.length) return '\\n\\nNo live searches are needed: every enabled section is covered by the feed items above. Do not search for, or add, anything outside the enabled sections.';
  return '\\n\\nAlso search for (these are SEARCH-SOURCED — see the SEARCH-SOURCED CONTENT rule; do NOT put them in the EXCLUDED ledger). Search ONLY for these; the user turned every other topic off:\\n' + tasks.map(t => '- ' + t).join('\\n');
}

`;

export const PAYLOAD_TOPIC_PATCHES = [
  {
    id: 'topics-always-include-payload',
    why: 'Leaks & Rumors was forced into every digest even when its topic was off.',
    from: "const ALWAYS_INCLUDE = new Set(['Everything Else', 'Leaks & Rumors']);",
    to: "const ALWAYS_INCLUDE = new Set(['Everything Else']);",
  },
  {
    id: 'topics-format-always-payload',
    why: 'The FORMAT rules told the model Blindspot and Leaks & Rumors "always appear", overriding the toggles.',
    from: '- ## 📋 Everything Else, ## 👁️ Blindspot Analysis, ## 🕵️ Leaks & Rumors, and ## 🗒️ EXCLUDED always appear — never omit, even if empty.',
    to: '- ## 📋 Everything Else and ## 🗒️ EXCLUDED always appear — never omit, even if empty.',
  },
  {
    id: 'topics-search-list-payload',
    // Must run before topics-search-fn-payload: the inserted function contains the same start marker.
    why: 'The hardcoded "Also search for" list (all topics) is replaced by searchTasks() in both the morning and nightly request.',
    between: ['\\n\\nAlso search for (these are SEARCH-SOURCED', 'that other major outlets are ignoring'],
    count: 2,
    to: "${searchTasks(mode === 'nightly')}",
  },
  {
    id: 'topics-search-fn-payload',
    why: 'Defines searchTasks(): the "Also search for" list built from the enabled topics only.',
    from: '// ── USER CONTENT ──',
    to: SEARCH_TASKS_FN + '// ── USER CONTENT ──',
  },
  {
    id: 'topics-search-placement-payload',
    why: 'Search results for disabled topics were landing in Everything Else.',
    from: "- Place search-sourced items in their best-fit topic section alongside feed items — that's expected and good.",
    to: "- Place search-sourced items in their best-fit topic section alongside feed items — that's expected and good.\n- Search-sourced items go ONLY in topic sections listed in REQUIRED HEADER ORDER — never in 📋 Everything Else, and never for a topic that isn't listed there (the user turned it off).",
  },
  {
    id: 'topics-comics-rules-payload',
    why: 'The Comics rules ("always show all 8 publishers") were sent even with Comics off.',
    from: 'COMICS SECTION RULES:\n',
    count: 2,
    to: 'COMICS SECTION RULES (apply ONLY if 📚 Comics is in REQUIRED HEADER ORDER; otherwise ignore this block):\n',
  },
];

const LEAKS_RULE = '- 🕵️ Leaks & Rumors — reports from journalists Tom Henderson, Jeff Grubb, Jason Schreier (via their outlets / social posts) and outlets Insider Gaming, VGC, Eurogamer, IGN, Kotaku, Giant Freakin Robot, MP1st. Label each item [Leak] / [Rumor] / [Report] / [Confirmed]; present as attributed claims, never as fact.';
const BF_RULE = '- 💼 Business & Finance — index levels (S&P 500, Nasdaq, Dow): ${mode === \'nightly\' ? "today\'s closing numbers" : \'premarket conditions\'}. Numbers from live search ONLY; if unavailable, "_No verified market data available._"';
const BLINDSPOT_RULE = "- 👁️ Blindspot Analysis — 2–3 niche or under-covered stories from the feed unlikely to hit mainstream front pages. Do NOT claim exclusivity you can't verify.";

/** Same patches for all five exporters; Gemini already had B&F / Blindspot out of SECTION_RULES. */
export function exporterTopicPatches(name) {
  const gemini = name === 'gemini';
  const p = [
    {
      id: 'topics-emoji',
      why: 'World News, Business & Finance and Blindspot become normal toggleable sections that follow the section order.',
      from: "'Security':'🔒','Comics':'📚','Notable Trends':'🔮','Leaks & Rumors':'🕵️',\n};",
      to: "'Security':'🔒','Comics':'📚','Notable Trends':'🔮','Leaks & Rumors':'🕵️',\n  'World News':'🌍','Business & Finance':'💼','Blindspot Analysis':'👁️',\n};",
    },
    {
      id: 'topics-rules-map',
      why: 'Section rules for the newly toggleable sections (same wording as the old hardcoded lines).',
      from: 'const SECTION_RULES_MAP = {\n',
      to: 'const SECTION_RULES_MAP = {\n'
        + "  'Business & Finance': `" + BF_RULE + '`,\n'
        + "  'World News': `- 🌍 World News — verified global reporting. No editorializing.`,\n"
        + "  'Blindspot Analysis': `" + BLINDSPOT_RULE + '`,\n'
        + "  'Leaks & Rumors': `" + LEAKS_RULE + '`,\n',
    },
    !gemini && {
      id: 'topics-bf-hardcoded',
      why: 'Business & Finance was always included; it now comes from the toggles.',
      from: BF_RULE + '\n${orderedEnabled',
      to: '${orderedEnabled',
    },
    !gemini && {
      id: 'topics-blindspot-hardcoded',
      why: 'Blindspot Analysis was always included; it now comes from the toggles.',
      from: BLINDSPOT_RULE + '\n- 🕵️',
      to: '- 🕵️',
    },
    {
      id: 'topics-leaks-hardcoded',
      why: 'Leaks & Rumors was always included (and listed twice); it now comes from the toggles, once.',
      from: LEAKS_RULE + '\n- 🗒️ EXCLUDED',
      to: '- 🗒️ EXCLUDED',
    },
    {
      id: 'topics-headers-bf',
      why: 'Hardcoded Business & Finance header removed (toggle-driven now).',
      from: "  '## 💼 Business & Finance',\n",
      to: '',
    },
    {
      id: 'topics-headers-blindspot-leaks',
      why: 'Hardcoded Blindspot and Leaks & Rumors headers removed: fixes the duplicate Leaks header and makes both toggleable.',
      from: "  '## 👁️ Blindspot Analysis',\n  '## 🕵️ Leaks & Rumors',\n",
      to: '',
    },
  ];
  return p.filter(Boolean).map(x => ({ ...x, id: `${x.id}-${name}` }));
}
