import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { env, dataDir } from './env.js';

// JSON lines to stdout and to data/logs/netrunner.log. Every run logs with a `runId` child.
function build() {
  const e = env();
  if (process.env.VITEST) return pino({ level: 'silent' });
  const dir = path.join(dataDir(), 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return pino(
    { level: e.LOG_LEVEL, base: undefined, timestamp: pino.stdTimeFunctions.isoTime },
    pino.multistream([
      { stream: process.stdout },
      { stream: pino.destination({ dest: path.join(dir, 'netrunner.log'), mkdir: true, sync: false }) },
    ]),
  );
}

export const log = build();
export type Logger = pino.Logger;
