# Changes from the n8n workflow

Source of truth for "what n8n did": the deployed workflow `jPDyDRnmxggd2IJo`, exported (secrets redacted) to `../n8n-export/`.
Everything not listed here was ported as-is.

## Prompt text

The Autopilot prompt (Build LLM Payload) and all 5 Manual-mode exporters run **byte-for-byte**. The deployed n8n code is wrapped in a small shim (`scripts/gen-prompts.mjs` → `src/pipeline/prompt/generated/`). The only edits are these patches. The generator verifies that each one matches exactly once:

| Patch | Where | Why |
|---|---|---|
| `filler-splice-payload` | Build LLM Payload | `update.py` spliced FILLER REJECTION into the middle of "NEVER invent, extrapolate, or assume…" and left a double period. The sentence is restored and FILLER is now its own bullet. |
| `filler-reason-payload` | Build LLM Payload | The ledger allowed only 4 reasons, but FILLER REJECTION requires `reason: filler`, and the model already emitted it. Added `filler` as a 5th valid reason. |
| `literal-template-gemini-bf` / `-uspol` | Gemini exporter | An escaped `\${…}` sent the literal text `${mode === 'nightly' ? …}` to the model. |
| `filler-splice-gemini` / `filler-reason-gemini` | Gemini exporter | Same two FILLER fixes as above. |
| `topics-*-payload` | Build LLM Payload | Topic toggles were ignored: it asked the model to web-search every topic (trending X topics, market numbers, comics, anime, science…) and forced Leaks & Rumors and Blindspot into every digest, so a Leaks-only digest came back full of other topics, mostly in Everything Else. Searches now follow the enabled topics, search results may only go in enabled sections (never Everything Else), and the Comics rules only apply when Comics is on. With every topic on, the search list is word-for-word what n8n sent. |
| `topics-*-<platform>` | all 5 exporters | Business & Finance, Blindspot and Leaks & Rumors were hardcoded into every prompt (Leaks twice: this was the duplicate-header issue) and World News was missing. All four are now normal toggleable sections that follow the section order. |
| `summary-length-def-*` / `summary-length-rule-*` | all 5 exporters | They hardcoded "SUMMARIES: 2–3 sentences each" and ignored Format → Summary length. They now use the same three rules as Build LLM Payload. |

**Added to the Autopilot system prompt** (required by omission protection): one `ITEM IDS` block asking the model to end each feed-item bullet with its `[#N017]` tag. Tags are stripped before anything is delivered or saved.

## Behavior

| Area | n8n | Now | Why |
|---|---|---|---|
| Config storage | `digest-config.json` saved by a browser file picker | SQLite (versioned), `GET/PUT /api/config`, zod-validated | Phase 3.1 |
| Secrets | API keys hardcoded in HTTP nodes and the config file; Discord URL in the config | `.env` only. The config API strips them; the UI shows "set / not set" | Requirement |
| Claude tier | `claude-haiku-4-5-20251001`, `max_tokens` 8192, raw HTTP | `claude-haiku-5-5` (current Haiku), `max_tokens` 32000, streaming, official SDK, `pause_turn` resumed | Current model; 8192 truncated long digests. Override with `CLAUDE_MODEL` |
| Claude text join | text blocks joined with `\n` | joined with `''` | Web-search citations split sentences across blocks, so `\n` broke them mid-line |
| LLM routing | canvas hardwired Gemini → Claude, Ollama disabled | `config.llm.primary` + `fallbackChain` honored, Ollama wired (RSS-only prompt, `num_ctx` 8192) | Phase 3.3 |
| Gemini key | `?key=` query param | `x-goog-api-key` header | Same auth; keeps the key out of URLs |
| Truncated output (`MAX_TOKENS`) | shipped with a ⚠️ banner | tries the next tier first; ships with the same banner only if no tier finishes | Fewer broken digests |
| All tiers fail | shipped "⚠️ No digest available…" to every target | run marked `error`, nothing delivered, attempts logged | Don't spam Discord or email with an error string |
| Omission protection | prompt wording only | IDs + programmatic diff, then re-run of only the missing items (≤2 rounds), then deterministic placement under 📋 Everything Else | Phase 3.4 |
| Schedule | triggers hardcoded at 7:00 and 20:00; UI times ignored | built from the Schedule tab (times, timezone, frequency, skipWeekends) on every save. On Windows it is synced to Task Scheduler, so it runs with the app closed, wakes the PC from sleep, and catches up missed runs. Elsewhere it uses in-process cron | Your decision |
| Rollup times | Sunday 12:00 / the 28th at 22:00 | same | — |
| Scheduled morning/nightly | mode guessed from hour < 12 | each job passes its mode explicitly | A nightly time before noon would have been mislabeled |
| Nightly continuity | read `{date}-morning.md`, which nothing wrote after June 26 | morning digest read from the DB | Bug |
| Developing stories | read from a node that runs later, so always empty | computed before the payload is built | Bug |
| Story tracker | regex over the whole digest, so EXCLUDED lines were saved as "stories"; UTC dates; JSON file at a hardcoded path | placed feed items (by ID) + untagged section bullets; your timezone; SQLite | Bug |
| Story tracker runs | twice per run (duplicate node) | once | Redundant |
| Rollups | prompt listed file paths the model couldn't open; crashed on Parse Response (`$('Build LLM Payload')`) | real digest text (falls back to headlines-only if it's too long); runs through the same engine | Bug |
| Rollup label | fell through to "🌙 Nightly Digest" | "📅 Weekly Rollup" / "🗓️ Monthly Recap" | Bug |
| Save to file | always `C:/Users/Zion/.n8n-files/digest-…txt`, raw digest, no header | `delivery.outputPath` (default `data/output`), `.md` or `.txt` per `fileFormat`, with Prep-File's header | Your decision |
| Email recipient | hardcoded to the owner's Gmail | `delivery.emailAddress`, falling back to `EMAIL_TO` | Bug |
| Dates in titles | server/n8n clock (and UTC in places) | configured timezone | Consistency |
| xCancel feeds | fetched every run, always dead (1971 placeholders) | not fetched; still listed in the UI as Coming Soon | Your decision |
| World News / Business & Finance / Blindspot | handled by the pipeline, but not toggleable in the UI (always on) | real Topics toggles | Your decision |
| Feed fetching | n8n RSS Read, sequential | `rss-parser` (same library), 8 in parallel, one at a time per host, 3 tries, no retry on 4xx | Speed and politeness |
| Dead-feed report | `.n8n-files/dead-feeds-DATE.txt` | `data/logs/dead-feeds-DATE.txt` + the `feed_results` table + the run log | Same text |
| Output tab | browser localStorage | server `digests` table (history imported from `.n8n-files`) | Survives cache clears; includes scheduled runs |
| UI runtime | unpinned React/Babel from unpkg | pinned (React 18.3.1, Babel 7.29.10) and served locally | Self-hosted |
| Run now → Autopilot | webhook had no respond node on that branch, so the UI likely never got the digest | `POST /api/run` returns `{digest, mode, date, digestId}` | Bug |
| Ollama in UI | "Coming Soon", unselectable | selectable | Now wired |
| Rollups tab | inert (toggles disabled) | working toggles | Now built |
| Scheduling on/off | always on | Schedule → Automatic digests switch | Off removes every Task Scheduler job, recaps included |
| Shorts / promo items | all passed to the model | Sources → Skip filler: Shorts and promo clips (clips, featurettes, launch/accolades trailers, "now playing", promo codes), both on by default | Dropped before the per-source cap; counts in run stats (`droppedShorts`, `droppedPromotional`) |
| EXCLUDED ledger | always delivered | Format → Show the Excluded list | The model still writes it and the saved digest keeps it; when off, it's left out of Discord/email/file and hidden in Output (peek button there) |
| Viewing a digest | Output tab only | Delivery → Open in NetRunner: a scheduled run opens the app on its digest (`desktop.ts --open /?digest=ID`) | Output also refreshes when opened |
| API keys / delivery accounts | hand-edit `.env`, restart | AI Writer → API keys and Delivery: edit Gemini/Claude keys, Ollama address, Discord webhook and the SMTP account in the app (written to `.env`, applied without a restart), plus Open .env / Show in folder | Secrets never leave the server (UI sees set + last 4). Writes only from this PC (loopback) and only from the NetRunner page (Origin check on every write) |
| Everything Else | always delivered | Topics → Catch-all sections: Everything Else and Excluded list toggles | The model still writes both (coverage needs them) and the saved digest keeps them; when off they are left out of deliveries and hidden in Output (Show/Hide buttons there) |
| Reddit fetching | one request per subreddit; logged-out Reddit allows ~1/min, so 5 of 6 got HTTP 429 | all enabled subreddits in one request (/r/a+b+c/.rss?limit=100, hot); a 429 waits the server's x-ratelimit-reset / Retry-After (max 65 s) before retrying | No Reddit login needed |
| Reddit tagging | case-sensitive path match: /r/Games/ never matched reddit.com/r/games, so every post was "Reddit / Notable Trends" (Leaks posts never reached Leaks & Rumors) | case-insensitive | Bug |
| Security / robustness (code review) | n/a | Host header must be localhost, an IP or ALLOWED_HOSTS (blocks DNS rebinding); .env edits validated before saving; startup error box text passed via env var; a second shutdown waits for in-flight runs; idle watchdog only when the window process isn't tracked; Task Scheduler info cached 5 min | |
