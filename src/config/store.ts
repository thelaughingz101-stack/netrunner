import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/db.js';
import { env, dataDir } from '../env.js';
import { log } from '../logger.js';
import { defaultConfig, normalizeConfig, type Config } from './schema.js';

type Listener = (c: Config) => void;
const listeners: Listener[] = [];

/** Latest config. First call seeds from LEGACY_CONFIG_PATH (if set) or defaults. */
export function getConfig(): { config: Config; version: number } {
  const row = db().prepare('SELECT version, json FROM config ORDER BY version DESC LIMIT 1').get() as
    | { version: number; json: string } | undefined;
  if (row) return { config: normalizeConfig(JSON.parse(row.json)), version: row.version };
  return { config: seed(), version: 1 };
}

export function saveConfig(input: unknown): { config: Config; version: number } {
  const config = normalizeConfig(input);
  const info = db().prepare('INSERT INTO config (json) VALUES (?)').run(JSON.stringify(config));
  for (const l of listeners) {
    try { l(config); } catch (e) { log.error({ err: e }, 'config listener failed'); }
  }
  return { config, version: Number(info.lastInsertRowid) };
}

export function onConfigChange(l: Listener): void {
  listeners.push(l);
}

/** Absolute output folder for file delivery. */
export function outputDir(c: Config): string {
  return c.delivery.outputPath ? path.resolve(c.delivery.outputPath) : path.join(dataDir(), 'output');
}

/** Which secrets are configured — shown in the UI instead of the secrets themselves. */
export function secretStatus() {
  const e = env();
  return {
    gemini: !!e.GEMINI_API_KEY,
    claude: !!e.ANTHROPIC_API_KEY,
    ollama: !!e.OLLAMA_URL,
    discordWebhook: !!e.DISCORD_WEBHOOK_URL,
    smtp: !!(e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASS),
  };
}

function seed(): Config {
  const legacy = env().LEGACY_CONFIG_PATH;
  let raw: unknown;
  if (legacy && fs.existsSync(legacy)) {
    try {
      raw = JSON.parse(fs.readFileSync(legacy, 'utf8'));
      log.info({ legacy }, 'imported legacy digest-config.json (secrets stripped)');
    } catch (e) {
      log.warn({ err: e, legacy }, 'legacy config unreadable — using defaults');
    }
  }
  const config = raw ? normalizeConfig(raw) : defaultConfig();
  db().prepare('INSERT INTO config (json) VALUES (?)').run(JSON.stringify(config));
  return config;
}
