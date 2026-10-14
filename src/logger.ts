import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { env, dataDir } from './env.js';
import { onVaultNote } from './vault.js';

// JSON lines to stdout and to data/logs/netrunner.log. Every run logs with a `runId` child.
function build() {
  if (process.env.VITEST) return pino({ level: 'silent' });
  // A bad .env value must not crash here, while the app is still loading: the desktop app reports it
  // in a message box when it calls env() itself. Until then, log with the defaults.
  let level = 'info', data = path.resolve(process.env.DATA_DIR || './data');
  try { level = env().LOG_LEVEL; data = dataDir(); } catch {}
  const dir = path.join(data, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return pino(
    { level, base: undefined, timestamp: pino.stdTimeFunctions.isoTime },
    pino.multistream([
      { stream: process.stdout },
      { stream: pino.destination({ dest: path.join(dir, 'netrunner.log'), mkdir: true, sync: false }) },
    ]),
  );
}

export const log = build();
onVaultNote(n => log[n.level]({ vault: true }, n.msg));
export type Logger = pino.Logger;
