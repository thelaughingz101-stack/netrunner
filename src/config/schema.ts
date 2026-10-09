import { z } from 'zod';
import { TOPICS, allToggleKeys } from '../catalog/index.js';

// Same shape as the n8n-era digest-config.json, so the Config UI needs no data changes.
// Secrets (llm.apiKeys, delivery.discordWebhookUrl) are accepted on input but always
// stripped before storage — they live in .env only.

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
const timezone = z.string().refine(tz => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}, 'unknown IANA timezone');

export const LOOKBACKS = ['12h', '24h', '3d', '1w', '2w', '1mo'] as const;
export const ENGINES = ['gemini', 'claude', 'ollama'] as const;
export const PLATFORMS = ['chatgpt', 'claude', 'gemini', 'grok', 'deepseek', 'notebooklm'] as const;

const YoutubeEntry = z.union([
  z.string().min(1),
  z.object({
    id: z.string().min(1),
    handle: z.string().nullable().optional(),
    title: z.string().nullable().optional(),   // channel name shown in the UI after Resolve
    avatar: z.string().nullable().optional(),
  }),
]);

export const ConfigSchema = z.object({
  topics: z.record(z.string(), z.boolean()).default({}),
  sources: z.record(z.string(), z.boolean()).nullable().default(null),
  delivery: z.object({
    discord: z.boolean().default(false),
    discordWebhookUrl: z.string().optional(),       // stripped — DISCORD_WEBHOOK_URL in .env
    email: z.boolean().default(false),
    emailAddress: z.string().default(''),
    textFile: z.boolean().default(false),
    openInApp: z.boolean().default(false),          // scheduled runs open the app window on the new digest
    chatbotExport: z.boolean().default(false),      // vestigial in the UI; kept for round-tripping
    chatbotPlatform: z.enum(PLATFORMS).default('chatgpt'),
    outputPath: z.string().default(''),             // '' → <DATA_DIR>/output
    fileFormat: z.enum(['md', 'txt']).default('md'),
  }).prefault({}),
  schedule: z.object({
    enabled: z.boolean().default(true),             // false = no automatic runs at all (recaps included)
    morningTime: hhmm.default('07:00'),
    nightlyTime: hhmm.default('20:00'),
    timezone: timezone.default('America/New_York'),
    frequency: z.enum(['twice_daily', 'once_daily', 'weekly']).default('twice_daily'),
    skipWeekends: z.boolean().default(false),
    lookbackWindow: z.enum(LOOKBACKS).default('12h'),
  }).prefault({}),
  llm: z.object({
    mode: z.enum(['llm', 'chatbot']).default('llm'),
    primary: z.enum(ENGINES).default('gemini'),
    fallbackChain: z.array(z.enum(ENGINES)).default(['claude', 'ollama']),
    apiKeys: z.record(z.string(), z.string()).optional(), // stripped — keys in .env
  }).prefault({}),
  format: z.object({
    summaryLength: z.enum(['1', '2-3', 'full']).default('2-3'),
    language: z.string().min(1).default('English'),
    sectionOrder: z.array(z.string()).default([]),
    // The AI always writes the 🗒️ EXCLUDED ledger (coverage checks need it) and the saved digest keeps it;
    // this only controls whether deliveries and the Output tab show it.
    showExcluded: z.boolean().default(true),
    // Same for 📋 Everything Else: the model still writes it (coverage needs a catch-all); this hides it.
    showEverythingElse: z.boolean().default(true),
  }).prefault({}),
  // Dropped before the per-source cap, so they don't crowd out real stories.
  filters: z.object({
    shorts: z.boolean().default(true),              // YouTube Shorts
    promotional: z.boolean().default(true),         // clips, featurettes, launch/accolades trailers, promo codes
  }).prefault({}),
  rollups: z.object({
    weekly: z.boolean().default(false),
    monthly: z.boolean().default(false),
  }).prefault({}),
  customSources: z.object({
    rss: z.array(z.string().url()).default([]),
    youtube: z.array(YoutubeEntry).default([]),
    xcancel: z.array(z.string().min(1)).default([]),
  }).prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Parse untrusted input → validated config with secrets removed and gaps filled. */
export function normalizeConfig(input: unknown): Config {
  const c = ConfigSchema.parse(input ?? {});
  delete c.llm.apiKeys;
  delete c.delivery.discordWebhookUrl;

  // Missing topic/source keys were already treated as ENABLED by the n8n pipeline
  // (`!== false`); fill them in explicitly so the UI shows what actually runs.
  for (const t of TOPICS) if (c.topics[t] === undefined) c.topics[t] = true;
  if (c.sources) for (const k of allToggleKeys()) if (c.sources[k] === undefined) c.sources[k] = true;
  // (Custom Feeds is added/removed by the UI's Format tab depending on whether custom sources exist.)
  for (const t of TOPICS) if (t !== 'Custom Feeds' && !c.format.sectionOrder.includes(t)) c.format.sectionOrder.push(t);

  // Chain never repeats the primary and never lists an engine twice.
  c.llm.fallbackChain = [...new Set(c.llm.fallbackChain)].filter(e => e !== c.llm.primary);
  return c;
}

export const defaultConfig = (): Config => normalizeConfig({ sources: Object.fromEntries(allToggleKeys().map(k => [k, true])) });
