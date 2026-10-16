# Per-topic digests, range-aware limits, collapsible Output

Status: approved by Zion and built (2026-10-16).

## Why
With every topic and source on (176 sources), a run finds ~560 stories. One AI call can't write that:
on 2026-10-15 Gemini hit its 65,536-token output limit, looped (US Politics repeated ~70×) and the
coverage step dumped 194 stories into Everything Else. On 2026-10-16 the 08:00 run failed outright
(Gemini overloaded ×5, Claude key rejected).

Separately, the catch-up range barely changes what goes in: each source keeps only its 8 newest stories
(`PER_SOURCE_CAP`, applied before the time window), so a "1 week" digest sees only the last few hours of
busy sites.

## Decisions (from Zion)
- Write big digests **one AI call per topic** (2026-10-16).
- **Both** stories-per-source and stories-per-topic **scale with the catch-up range**, growing but slowing
  down (not exponential).
- Discord stays as it is.
- Output tab topics become collapsible.

## 1. Range-aware limits (ingest)

| Catch-up range | 12 h | 24 h | 3 d | 1 week | 2 weeks | 1 month |
|---|---|---|---|---|---|---|
| Stories per source (was always 8) | 8 | 12 | 20 | 30 | 40 | 50 |
| Stories per topic | 25 | 30 | 40 | 55 | 65 | 80 |

- **Per source**: the cap moves to after the time window, so it keeps the newest N stories *inside the range*
  (today it can keep stories the window then throws away). Built-in sources only, as now; custom feeds
  stay exempt. Feeds only return their latest ~10–50 items, so this is also bounded by the feed itself.
- **Per topic**: after clustering and the topic toggles, each topic keeps its top N stories: most outlets
  first (`clusterSize`), then newest. Custom Feeds exempt (hand-picked). Dropped stories are counted in the
  run stats (`droppedTopicLimit`), like the other filters.
- Both tables live in one place (`src/pipeline/limits.ts`) next to `LOOKBACK_HOURS_MAP`.

## 2. One AI call per topic (when the run is big)
- Runs with ≤ `LLM_ITEMS_PER_CALL` stories (default 150, `.env`) stay **one call**, exactly as today
  (cheaper, and the AI sees cross-topic duplicates).
- Bigger runs: **one call per enabled topic that has stories**, plus one call for enabled topics with no
  feed stories (search-only ones like Blindspot Analysis or market numbers), if any.
- Each call: `buildLlmPayload` with a copy of the config where only that topic is on (its searches and
  rules follow), `customSources` emptied unless the topic is Custom Feeds, the ID rule, and
  `ensureCoverage` over that topic's stories. IDs are assigned once for the whole run first.
- Nightly: each call gets this morning's sections for its own topics (so Story Updates covers every topic);
  🔄 Story Updates is kept only from calls that had such a slice (from the first call if none did), so other
  calls' "nothing to update" lines never leak in. Developing stories go to the first call only. (Changed after
  the final review, 2026-10-16: originally only the first call saw the morning digest.)
- **3 calls at a time** (Gemini per-minute limits); a 16-topic run takes ~5 min.
- **Stitching** (new `src/pipeline/split.ts`): parse each answer into sections by header (`sections` /
  `headerKey` from `coverage.ts`), then output in the run's order: Story Updates, topics in the configured
  section order, Custom Feeds, one 📋 Everything Else, one 🗒️ EXCLUDED. A placeholder line
  ("_Nothing outside…_", "EXCLUDED: none") is kept only if no call had bullets for that section. A
  truncation banner from any call is kept at the top.
- **A topic that fails** (every AI tier failed): the digest still goes out. A note at the top names the
  failed topics and why (the plain-English `explain.ts` text), and their stories are listed under their own
  topic header as plain headline links. If every call fails, the run fails as today.
- Stats: `ctx.stats.llm` gets `calls`, per-call tier/finishReason, and `truncated` if any call was;
  `ctx.stats.coverage` is summed across calls.
- Sections are stitched in the configured section order (search-only topics included), not call order.
- Run button hover: "Writing by topic: 5 of 16 done · Gaming: Gemini was overloaded with requests, so
  trying again (attempt 2 of 5)".
- Free Copy-Paste mode and weekly/monthly recaps are unchanged.

## 3. Safety nets (every digest)
- **Repeated bullets removed**: after stitching/coverage, a bullet whose text (tags and spacing ignored)
  repeats an earlier bullet is dropped. Would have fixed 2026-10-15's loop.
- **Loops inside a line** (added after the first per-topic run, 2026-10-16: Gemini wrote ~35,000 "2"s into a
  made-up Comics link): a line with a run of 200+ repeated characters is dropped and the AI is asked once more,
  then the next AI; with nothing better, the answer ships without those lines (`dropRunaways` in `engine.ts`).
- **Gemini's tag wording** (same run: `[cite: N034]`) counts as the id tag (`normalizeTags`), so those
  stories aren't treated as dropped and written twice.
- **Longer waits when an AI is overloaded**: for 429/503/529 the retry delay grows (5 s, 15 s, 45 s, then
  2 min max) instead of a flat 5 s, giving a demand spike time to pass.

## 4. Collapsible topics in the Output tab
- Each `##` section renders as a fold-out block: click the header to collapse/expand; header shows the
  section name and its number of stories.
- "Collapse all" / "Expand all" buttons next to the existing Show/Hide buttons.
- Collapsed sections are remembered per section name (localStorage; harmless if unavailable).
- Discord and email unchanged.

## Testing
- Unit: limit tables; per-source cap after the window; per-topic ranking (clusterSize, then newest;
  Custom Feeds exempt); deciding when to split; topic grouping incl. search-only topics; stitching
  (order, merged Everything Else/EXCLUDED, placeholders, Story Updates once, banner kept); duplicate-bullet
  removal; failed-topic note + plain headlines; all-fail → error; backoff schedule.
- End to end (scripted LLM, `tests/pipeline-e2e.test.ts`): a run over the threshold makes one call per
  topic, every story is accounted for, stats/hover stages are right; a run under it makes one call.
- UI: compiles; sections collapsible; screenshots of the Output tab in the sandbox.

## Not in scope
Discord layout changes (forum posts/spoilers), email layout, Gemini model fallback (e.g. Flash-Lite when
2.5 Flash is overloaded: possible later).
