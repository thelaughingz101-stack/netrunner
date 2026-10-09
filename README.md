# NetRunner

A self-hosted news digest. NetRunner pulls ~160 RSS / YouTube / Reddit / podcast feeds plus your own custom sources, filters and de-duplicates them, and has an LLM write a sectioned Markdown digest. The LLM chain is Gemini with Google Search, then Claude Haiku with web search, then local Ollama. The digest is delivered to Discord, email, and/or a file on a schedule. Everything is managed from a single config page.

It replaces the n8n workflow it grew out of. See `CHANGES_FROM_N8N.md` for every intentional difference.

---

## Setup

Requirements: **Node.js 22+** (24 recommended), or Docker.

```bash
cd netrunner-app
npm install                  # also vendors the pinned React/Babel for the UI
cp .env.example .env         # Windows: copy .env.example .env
```

Fill in `.env`. Every secret lives here, never in the config page or the database.

| Variable | Needed for |
|---|---|
| `GEMINI_API_KEY` | Gemini tier (from aistudio.google.com) |
| `ANTHROPIC_API_KEY` | Claude tier (from console.anthropic.com) |
| `OLLAMA_URL`, `OLLAMA_MODEL` | Local Ollama tier (default `http://localhost:11434`, `llama3:latest`) |
| `DISCORD_WEBHOOK_URL` | Discord delivery (Server Settings → Integrations → Webhooks) |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `EMAIL_FROM` `EMAIL_TO` | Email delivery. For Gmail: `smtp.gmail.com`, `465`, `true`, and an App Password |
| `LEGACY_CONFIG_PATH` | Optional. On first boot, imports an n8n-era `digest-config.json` (any secrets in it are ignored) |

You only need keys for the tiers you use. A tier without a key is skipped and logged.

### Bringing over your n8n history (optional, one time)

```bash
npm run import:n8n -- C:/Users/<you>/.n8n-files
```

This imports past digests into the Output tab and the story tracker, leaving out the junk entries the old regex captured. It's safe to re-run.

## Running

### Windows: desktop app

```bash
npm run install:desktop   # one time: builds the icon, adds "NetRunner" to the Desktop and Start menu
```

Double-click **NetRunner**. It opens the config page in its own window, with no terminal and no browser tabs. **Closing the window shuts NetRunner down completely.**

Scheduled digests don't need the window. Each time you Save, the Schedule tab is synced to **Windows Task Scheduler**, under the `\NetRunner\` folder. Task Scheduler runs each digest headless at its time:
- with the app closed or after a reboot (you only need to be logged in);
- it can wake the PC from sleep;
- a run missed while the PC was off starts as soon as it's back on.

Runs never overlap: a scheduled run that finds another in progress waits for it. To see the jobs, open Task Scheduler → NetRunner. Change them from the Schedule tab, not there.

### Anywhere: server

```bash
npm start            # server + config page on http://127.0.0.1:8787
```

On Docker or a Pi, set `SCHEDULER=internal` (the default off Windows) so the server fires the schedule itself while it runs. `SCHEDULER=off` disables scheduled runs and removes the Windows tasks.

Open **http://127.0.0.1:8787**. The config page is served by the app itself, so don't open the HTML file directly. To reach it from other machines on your network, set `HOST=0.0.0.0`.

| Command | What it does |
|---|---|
| `npm run install:desktop` | (Windows) Builds the icon and creates the Desktop / Start menu shortcuts |
| `npm run desktop` | Runs the desktop app (what the shortcut runs) |
| `npm start` | Runs the server only |
| `npm run digest` | Runs one digest now from the terminal (mode picked from the time of day) |
| `npm run digest -- --dry-run` | Full pipeline, including LLM calls, but **delivers nothing**. Previews land in `data/dry-run/<runId>/` |
| `npm run digest -- --mode nightly --lookback 24h` | Force a mode (`morning`/`nightly`/`weekly`/`monthly`) and lookback |
| `npm run digest -- --prompt` | Manual mode: build the copy-paste chatbot prompt |
| `npm test` | Test suite (dedupe, LLM fallback chain, ID-diff coverage, delivery, and more) |
| `npm run typecheck` | TypeScript check |

### Docker

```bash
docker compose up -d --build     # data persists in ./data
```

The image is multi-arch (amd64/arm64), so it also runs on a Raspberry Pi. For an Ollama instance on the host, see `OLLAMA_URL` in `docker-compose.yml`.

## Configuring

Everything is set from the config page. **Save** writes it to the server, and the next run uses it.

- **Topics / Sources / Custom**: which categories and feeds run. Custom RSS feeds and YouTube channels are added here; paste a channel URL or `@handle` and hit **Resolve**.
- **Format**: summary length, language, section order.
- **AI Engine**: Autopilot (primary model + fallback order) or Manual (copy-paste prompt for ChatGPT/Claude/Gemini/Grok/DeepSeek). The key status comes from `.env`.
- **Delivery**: Discord, Email, and Save-to-file. Each is toggled independently. The file output goes to `data/output/` unless you set a folder.
- **Schedule**: times, timezone, frequency and skip-weekends drive the scheduler directly. Jobs are rebuilt on every save. **Lookback** sets how far back feeds are scanned.
- **Rollups**: the weekly rollup runs Sundays at 12:00, and the monthly recap on the 28th at 22:00, both written from that period's saved digests.
- **Output**: every digest the server has produced, plus `.md` imports.

## How a run works

```
trigger (cron | Run button | CLI)
  → config → mode + lookback
  → fetch feeds (parallel, retried, dead feeds logged) → tag sources → time window
  → dedupe → same-story clustering → topic toggles
  → [Autopilot] assign IDs N001… → prompt (+ ID rule) → Gemini → Claude → Ollama
        → diff output IDs vs. the item list → re-run ONLY the missing items (≤2 rounds)
        → anything still missing is listed under 📋 Everything Else → strip tags
  → [Manual] platform exporter → copy-paste prompt
  → save digest → story tracker → Discord / Email / File
```

Every run writes a structured record covering feeds fetched, empty and failed; items dropped at each stage; which LLM tier answered and every attempt; coverage per round; and the status of each delivery. Find it in:
- `GET /api/runs` and `GET /api/runs/<id>` (including per-feed and per-item detail)
- `data/logs/netrunner.log` (JSON lines, one `runId` per run)

## Adding a new source

1. Add the feed to `src/catalog/feeds.extra.ts`:
   ```ts
   { name: 'The Guardian World', category: 'World News', type: 'rss', url: 'https://www.theguardian.com/world/rss' },
   ```
   - `category` must be one of `TOPICS` in `src/catalog/index.ts`.
   - Give a brand's several feeds (RSS + YouTube) the same `sourceKey` so they share one toggle.
2. Tell the tagger how to recognise its items in `src/catalog/sourceMap.extra.ts`:
   - RSS: map the item links' domain, e.g. `'theguardian.com': { name: 'The Guardian', category: 'World News' }`. Use a domain+path key like `'reddit.com/r/foo'` for path-specific feeds.
   - YouTube: map the feed's `<author>` string in `EXTRA_YOUTUBE_AUTHORS`.

   Unrecognised items still come through, under **Custom Feeds**.
3. Restart. The source appears in the Sources tab automatically, because the UI reads the same catalog via `/api/catalog`.

For a one-off feed you don't need a toggle for, use the **Custom** tab instead; no code needed.

New *topic* (category)? Add it to `TOPICS`. To give it its own section in the Autopilot prompt, it also needs an entry in Build LLM Payload's `CATEGORY_META`. That code is generated verbatim from the n8n export by `scripts/gen-prompts.mjs`, so patch it there.

## Adding a new delivery target

1. Implement `DeliveryTarget` (`src/pipeline/delivery/types.ts`) in `src/pipeline/delivery/targets.ts`:
   ```ts
   export const telegram = (): DeliveryTarget => ({
     name: 'telegram',
     enabled: c => c.delivery.telegram === true,
     misconfigured: () => (process.env.TELEGRAM_BOT_TOKEN ? null : 'TELEGRAM_BOT_TOKEN not set in .env'),
     render(input, ctx) {
       return {
         summary: '1 message',
         preview: { 'telegram.md': input.digest },   // written on dry runs instead of sending
         send: async () => { /* POST to the Telegram API */ return 'sent'; },
       };
     },
   });
   ```
2. Add it to `TARGETS` in `src/pipeline/delivery/registry.ts`.
3. Add the toggle (`telegram: z.boolean().default(false)`) to `delivery` in `src/config/schema.ts`, any secret to `src/env.ts` and `.env.example`, and a `<Row>` + `<Toggle>` in the Delivery tab of `public/netrunner-config.html`.

Dry runs, the run log, and "one failing target never blocks the others" come for free.

## Project layout

```
src/
  index.ts            npm start                cli.ts            npm run digest + scheduled jobs
  desktop.ts          desktop app window       scheduler.ts      jobs from config
  schedule/windows.ts Task Scheduler sync      server/start.ts   boot (shared)
  env.ts              .env schema (secrets)
  config/             zod schema + SQLite store
  catalog/            feed list + source maps (generated verbatim from n8n) + extras
  pipeline/
    run.ts            orchestrator             runs.ts           run records
    ingest/           fetch, normalize, time window, dedupe, cluster, topic filter
    prompt/           Build LLM Payload + 5 exporters (verbatim n8n code under a shim)
    llm/              Gemini / Claude / Ollama + fallback engine
    coverage/         ID injection, diff, recovery, merge
    format/           Discord chunks, MD→HTML, file header
    delivery/         Discord, email, file + registry
    rollups.ts        weekly / monthly
  stories/tracker.ts  story tracker
  server/             Fastify app + routes
public/netrunner-config.html   the config page
scripts/            gen-catalog / gen-prompts (re-sync from n8n-export), vendor, import-n8n-files
data/               netrunner.db, logs/, output/, dry-run/ (gitignored)
```

## Known feed problems (as of 2026-10-08, same as n8n's last dead-feed report)

- **Wrong YouTube channel IDs:** CNET TV, Unbox Therapy, Bloomberg, Business Insider. Fix them with the Resolve button and update `feeds.generated.ts` → `feeds.extra.ts`.
- **404:** Billboard RSS, Google Trends daily RSS, Yahoo News most-viewed.
- **Reddit:** `.rss` feeds return 429 for unauthenticated clients.
- **Empty today:** AP News and Reuters via Google News `allinurl:`.
- **xCancel:** not fetched (globally blocked).
