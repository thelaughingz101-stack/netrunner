import { setEnvForTests, type Env } from '../src/env.js';
import { openDb, useDb } from '../src/db/db.js';

/** Fresh in-memory DB + isolated env for each test file. */
export function freshState(envOverrides: Partial<Env> = {}) {
  setEnvForTests({ DATA_DIR: './.test-data', ...envOverrides });
  const d = openDb(':memory:');
  useDb(d);
  return d;
}
