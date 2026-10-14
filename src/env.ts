import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';
import { initVault } from './vault.js';

// Before anything reads process.env: decrypt the API keys (Windows) and move plain-text ones out of .env.
initVault();

// Secrets and machine-specific settings live ONLY here (.env, or encrypted by vault.ts), never in config or code.
const optional = z.string().trim().optional().transform(v => (v ? v : undefined));
const int = (def: number) => z.coerce.number().int().positive().default(def);
const bool = (def: boolean) =>
  z.enum(['true', 'false', '1', '0']).optional().transform(v => (v === undefined ? def : v === 'true' || v === '1'));

const EnvSchema = z.object({
  PORT: int(8787),
  HOST: z.string().default('127.0.0.1'),
  // Extra hostnames the server answers to (comma-separated), e.g. "pi.local" when reached over the LAN.
  // localhost and IP addresses always work; other names are refused to block DNS-rebinding attacks.
  ALLOWED_HOSTS: optional,
  DATA_DIR: z.string().default('./data'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  GEMINI_API_KEY: optional,
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  ANTHROPIC_API_KEY: optional,
  CLAUDE_MODEL: z.string().default('claude-haiku-5-5'),
  OLLAMA_URL: z.string().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3:latest'),

  // Digest calls get max(LLM_TIMEOUT_MS, sources × LLM_TIMEOUT_PER_SOURCE_MS), capped at LLM_TIMEOUT_MAX_MS.
  LLM_TIMEOUT_MS: int(600_000),
  LLM_TIMEOUT_PER_SOURCE_MS: int(4_000),
  LLM_TIMEOUT_MAX_MS: int(1_800_000),
  LLM_MAX_TRIES: int(5),
  LLM_RETRY_DELAY_MS: int(5_000),
  FEED_TIMEOUT_MS: int(20_000),
  FEED_CONCURRENCY: int(8),

  DISCORD_WEBHOOK_URL: optional,

  SMTP_HOST: optional,
  SMTP_PORT: int(465),
  SMTP_SECURE: bool(true),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  EMAIL_FROM: optional,
  EMAIL_TO: optional,

  // Who fires scheduled digests. "windows" registers Task Scheduler jobs (run even when the app is closed);
  // "internal" runs node-cron inside the server (Docker / Pi); "off" disables both. Default: windows on Windows.
  SCHEDULER: z.enum(['windows', 'internal', 'off']).default(process.platform === 'win32' ? 'windows' : 'internal'),

  // First boot only: import an existing n8n-era digest-config.json (secrets are stripped).
  LEGACY_CONFIG_PATH: optional,
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;
/** A value in .env (or the environment) NetRunner can't use. The message names each bad setting. */
export class EnvError extends Error {
  constructor(readonly issues: { key: string; message: string }[]) {
    super(`a setting in .env has a value NetRunner can't use: ${issues.map(i => `${i.key}: ${i.message}`).join('; ')}`);
  }
}

export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) throw new EnvError(parsed.error.issues.map(i => ({ key: i.path.join('.'), message: i.message })));
    cached = parsed.data;
  }
  return cached;
}

/** Throws (ZodError → HTTP 400) if these values would make the env invalid, so nothing bad gets saved. */
export function validateEnvUpdate(updates: Record<string, string>): void {
  const next: Record<string, string | undefined> = { ...process.env, ...updates };
  for (const [k, v] of Object.entries(updates)) if (!v) delete next[k];
  EnvSchema.parse(next);
}

/** Re-reads process.env (after the Config UI writes .env). */
export function reloadEnv(): void {
  cached = undefined;
}

/** Tests use this to inject values without touching process.env. */
export function setEnvForTests(overrides: Partial<Env>): void {
  cached = { ...EnvSchema.parse({}), ...overrides };
}

export const dataDir = () => path.resolve(env().DATA_DIR);
