# NetRunner

**NetRunner reads ~160 news sites, YouTube channels and subreddits for you and turns them into one short, organised news digest, on a schedule, delivered to Discord, email or a file.**

You pick the topics and sources. An AI (Google Gemini, Claude, or a local Ollama model) writes the digest. If you don't want to use an AI key, NetRunner can instead prepare a ready-to-paste prompt for ChatGPT, Claude, Gemini, Grok or DeepSeek.

---

## Quick start (Windows, no technical knowledge needed)

1. **Download NetRunner.** Open the [latest release](../../releases/latest) and click **NetRunner-vX.Y.Z.zip** under *Assets*.
2. **Extract it.** Right-click the downloaded zip → **Extract All…** → choose a folder you'll keep, for example `Documents\NetRunner`.
   NetRunner runs from this folder, so don't run it from inside the zip and don't delete the folder afterwards.
3. **Double-click `Setup NetRunner`** in the extracted folder.
   - If Windows shows a security warning, click **More info → Run anyway** (or **Run**).
   - If Windows asks for permission to install **Node.js**, click **Yes**.
4. Wait until the window says **DONE** (usually a few minutes). NetRunner then opens by itself.

The setup file:
- installs **Node.js** (the engine NetRunner runs on) if your PC doesn't have it,
- installs everything else NetRunner needs,
- adds a **NetRunner** icon to your Desktop and Start menu,
- opens NetRunner.

Scheduled digests are set up the first time you press **Save** in the app. They then run in the background through Windows' own Task Scheduler, even when NetRunner is closed.

Ran into a problem? The setup window explains what to do in plain English. You can always run `Setup NetRunner` again: it's safe, and it also repairs the shortcut if you moved the folder.

---

## Using NetRunner (no terminal needed)

Open NetRunner from the **Desktop icon** or by searching **NetRunner** in the Start menu. It opens in its own window. **Closing the window closes NetRunner**; scheduled digests still run.

### First time

1. **Start tab:** pick a template (or start blank).
2. **Topics tab:** switch on the topics you care about (Gaming, World News, AI…).
3. **AI Writer tab:** choose how the digest gets written:
   - **Autopilot:** NetRunner writes it for you. Paste a key under **API keys** (see the next section).
   - **Free Copy-Paste:** no key needed. NetRunner gives you a prompt to paste into ChatGPT, Claude, Gemini, Grok or DeepSeek.
4. **Delivery tab:** choose where the digest goes (Discord, email, a file, or just the Output tab).
5. **Schedule tab:** choose when it runs (once or twice a day, or weekly).
6. Press **Save**. To try it right away, press **Run News Digest** at the bottom.

Every digest is kept in the **Output** tab.

### Adding your keys and links

You never need to edit a file by hand. Everything is typed into the app, and saved keys are shown only as their last four characters.

| In the app | Where | How to get it |
|---|---|---|
| **Gemini API key** | AI Writer → API keys | [aistudio.google.com](https://aistudio.google.com) → **Get API key**. Recommended, and it has a free tier. |
| **Claude API key** | AI Writer → API keys | [console.anthropic.com](https://console.anthropic.com) → **API Keys** |
| **Ollama address** | AI Writer → API keys | Only if you run Ollama on your PC. Usually leave it as `http://localhost:11434`. |
| **Discord webhook URL** | Delivery → Discord | In Discord: **Server Settings → Integrations → Webhooks → New Webhook**, pick a channel, **Copy Webhook URL**. |
| **Email settings** (server, port, username, password) | Delivery → Email → Sending account | For Gmail: server `smtp.gmail.com`, port `465`, your Gmail address, and an **App Password** (Google Account → Security → App passwords), not your normal password. |

You only need a key for the AI you actually use. Changes take effect immediately, no restart needed.

### What each tab does

| Tab | What you set there |
|---|---|
| **Start** | Ready-made starting setups. |
| **Topics** | Which topics appear. The **Catch-all sections** card at the bottom switches the *Everything Else* and *Excluded list* sections on or off. |
| **Sources** | Individual sites and channels per topic. *Skip filler* drops YouTube Shorts and promo clips. *Add your own* takes any RSS feed or YouTube channel. |
| **Format** | Summary length (1 sentence, 2–3, or full), language, and section order. |
| **AI Writer** | Autopilot or Free Copy-Paste, which AI to use first, backups if it fails, and your keys. |
| **Schedule** | Turn automatic digests on or off, times, timezone, how far back to look, and weekly/monthly recaps. |
| **Delivery** | Discord, email, save to file, and *Open in NetRunner* (opens the app on each new scheduled digest). |
| **Output** | Every digest NetRunner has made, ready to read. |

---

## Troubleshooting & known issues

**NetRunner won't open, or a digest never arrived:**
- Run `Setup NetRunner` again (safe to repeat).
- Check **Schedule → Next runs** to see when the next digest is due.
- Scheduled digests need you to be logged in to Windows. A run missed while the PC was off starts when it's back on.
- Details of every run are in `data\logs\netrunner.log` in the NetRunner folder.

**Known feed issues (optional, nothing to fix for normal use):**
- **Hacker News** sometimes answers "slow down" (HTTP 419). It's retried automatically and usually works on the next run.
- **Space.com** occasionally returns an empty feed.
- **X / Twitter** accounts are not fetched yet (shown as *Coming soon*).

---

## Advanced / developer setup

Everything below is optional and needs a terminal.

### Manual install

Requirements: **Node.js 22+** (24 recommended), or Docker.

```bash
git clone <this repo> netrunner-app
cd netrunner-app
npm ci                       # also vendors the pinned React/Babel for the UI
cp .env.example .env         # Windows: copy .env.example .env
npm run install:desktop      # Windows only: icon + Desktop / Start menu shortcuts
```

`Setup NetRunner.cmd` runs the same steps. Add `--no-shortcuts` to install without creating shortcuts or opening the app.

### Settings file (`.env`)

The app's key fields write to `.env` for you. These are the underlying names, if you'd rather edit the file (AI Writer and Delivery both have **Open .env** / **Show in folder** links).

| On screen | `.env` name |
|---|---|
| Gemini API key | `GEMINI_API_KEY` (model: `GEMINI_MODEL`) |
| Claude API key | `ANTHROPIC_API_KEY` (model: `CLAUDE_MODEL`) |
| Ollama address | `OLLAMA_URL` (model: `OLLAMA_MODEL`) |
| Discord webhook URL | `DISCORD_WEBHOOK_URL` |
| Email sending account | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `EMAIL_TO` |
| (not in the app) | `PORT`, `HOST`, `ALLOWED_HOSTS`, `DATA_DIR`, `SCHEDULER`, `LOG_LEVEL`, timeouts, `LEGACY_CONFIG_PATH` |

See `.env.example` for what each one does. `ALLOWED_HOSTS` matters only if you reach NetRunner by a hostname other than `localhost` or an IP address. Other names are refused, which blocks DNS-rebinding attacks.

### Commands

| Command | What it does |
|---|---|
| `npm run desktop` | Runs the desktop app (what the shortcut runs) |
| `npm start` | Runs the server only, on http://127.0.0.1:8787 |
| `npm run digest` | Runs one digest now (mode picked from the time of day) |
| `npm run digest -- --dry-run` | Full pipeline, including AI calls, but **delivers nothing**. Previews land in `data/dry-run/<runId>/` |
| `npm run digest -- --mode nightly --lookback 24h` | Force a mode (`morning`/`nightly`/`weekly`/`monthly`) and lookback |
| `npm run digest -- --prompt` | Copy-paste mode: build the chatbot prompt |
| `npm run import:n8n -- C:/Users/<you>/.n8n-files` | One time: import past n8n digests into Output and the story tracker |
| `npm test` / `npm run typecheck` | Test suite / TypeScript check |

The config page is served by the app itself, so open **http://127.0.0.1:8787** rather than the HTML file. To reach it from other machines on your network, set `HOST=0.0.0.0`.

### Scheduling

On Windows, each **Save** syncs the Schedule tab to **Windows Task Scheduler** under `\NetRunner\`. Each digest runs headless at its time: with the app closed, after a reboot (you only need to be logged in), it can wake the PC from sleep, and a missed run starts when the PC is back on. Runs never overlap. Change the jobs from the Schedule tab, not from Task Scheduler.

On Docker or a Pi, `SCHEDULER=internal` (the default off Windows) makes the server fire the schedule itself while it runs. `SCHEDULER=off` disables scheduled runs.

### Docker

```bash
docker compose up -d --build     # data persists in ./data
```

The image is multi-arch (amd64/arm64), so it also runs on a Raspberry Pi. For an Ollama instance on the host, see `OLLAMA_URL` in `docker-compose.yml`.

### How a run works

```
trigger (schedule | Run button | CLI)
  → config → mode + lookback
  → fetch feeds (parallel, retried; Reddit in one combined request) → drop Shorts / promo
  → tag sources → time window → dedupe → same-story clustering → topic toggles
  → [Autopilot] assign IDs N001… → prompt (+ ID rule) → Gemini → Claude → Ollama
        → diff output IDs vs. the item list → re-run ONLY the missing items (≤2 rounds)
        → anything still missing is listed under 📋 Everything Else → strip tags
  → [Copy-Paste] platform exporter → copy-paste prompt
  → save digest → story tracker → Discord / Email / File (minus hidden sections)
```

Every run writes a structured record: feeds fetched, empty and failed; items dropped at each stage; which AI answered and every attempt; coverage per round; and each delivery's status. Find it in `GET /api/runs`, `GET /api/runs/<id>`, and `data/logs/netrunner.log` (JSON lines, one `runId` per run).

It replaces the n8n workflow it grew out of. See `CHANGES_FROM_N8N.md` for every intentional difference.

### Adding a new source

1. Add the feed to `src/catalog/feeds.extra.ts`:
   ```ts
   { name: 'The Guardian World', category: 'World News', type: 'rss', url: 'https://www.theguardian.com/world/rss' },
   ```
   - `category` must be one of `TOPICS` in `src/catalog/index.ts`.
   - Give a brand's several feeds (RSS + YouTube) the same `sourceKey` so they share one toggle.
2. Tell the tagger how to recognise its items in `src/catalog/sourceMap.extra.ts`:
   - RSS: map the item links' domain, e.g. `'theguardian.com': { name: 'The Guardian', category: 'World News' }`. Use a domain+path key like `'reddit.com/r/foo'` for path-specific feeds (matched case-insensitively).
   - YouTube: map the feed's `<author>` string in `EXTRA_YOUTUBE_AUTHORS`.

   Unrecognised items still come through, under **Custom Feeds**.
3. Restart. The source appears in the Sources tab automatically, because the UI reads the same catalog via `/api/catalog`.

For a one-off feed you don't need a toggle for, use **Sources → Add your own** instead; no code needed.

New *topic* (category)? Add it to `TOPICS`. To give it its own section in the Autopilot prompt, it also needs an entry in Build LLM Payload's `CATEGORY_META`. That code is generated verbatim from the n8n export by `scripts/gen-prompts.mjs`, so patch it there (see `scripts/topic-patches.mjs` for examples).

### Adding a new delivery target

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
3. Add the toggle (`telegram: z.boolean().default(false)`) to `delivery` in `src/config/schema.ts`, the secret to `src/env.ts`, `.env.example` and `EDITABLE` in `src/secrets.ts` (so it can be entered in the app), and a `<Row>` + `<Toggle>` + `<KeyField>` in the Delivery tab of `public/netrunner-config.html`.

Dry runs, the run log, and "one failing target never blocks the others" come for free.

### Project layout

```
Setup NetRunner.cmd   one-click Windows setup
src/
  index.ts            npm start                cli.ts            npm run digest + scheduled jobs
  desktop.ts          desktop app window       scheduler.ts      jobs from config
  schedule/windows.ts Task Scheduler sync      server/start.ts   boot (shared)
  env.ts              .env schema              secrets.ts        in-app .env editing
  config/             zod schema + SQLite store
  catalog/            feed list + source maps (generated verbatim from n8n) + extras
  pipeline/
    run.ts            orchestrator             runs.ts           run records
    ingest/           fetch, Shorts/promo filter, normalize, time window, dedupe, cluster, topic filter
    prompt/           Build LLM Payload + 5 exporters (verbatim n8n code under a shim, plus flagged patches)
    llm/              Gemini / Claude / Ollama + fallback engine
    coverage/         ID injection, diff, recovery, merge, hidden-section stripping
    format/           Discord chunks, MD→HTML, file header
    delivery/         Discord, email, file + registry
    rollups.ts        weekly / monthly
  stories/tracker.ts  story tracker
  server/             Fastify app + routes
public/netrunner-config.html   the config page
scripts/            gen-catalog / gen-prompts / topic-patches (re-sync from n8n-export), vendor, install-desktop, import-n8n-files
data/               netrunner.db, logs/, output/, dry-run/ (gitignored)
```
