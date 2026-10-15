import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { dataDir } from '../env.js';
import { MIGRATIONS } from './migrations.js';

export type DB = Database.Database;

let instance: DB | undefined;

export function openDb(file?: string): DB {
  const target = file ?? path.join(dataDir(), 'netrunner.db');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/**
 * better-sqlite3's compiled part is missing or built for a different Node.js: the install skipped its build
 * (npm 12 without an allowScripts entry, or `ignore-scripts` set), or Node.js was updated since. Re-running
 * Setup rebuilds it.
 */
export function isNativeBuildError(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException | undefined;
  return e?.code === 'ERR_DLOPEN_FAILED' || /Could not locate the bindings file|NODE_MODULE_VERSION/.test(e?.message ?? '');
}

export function db(): DB {
  if (!instance) instance = openDb();
  return instance;
}

/** Tests swap in an in-memory database. */
export function useDb(d: DB): void {
  instance = d;
}

function migrate(d: DB): void {
  d.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = d.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  const current = row.v ?? 0;
  for (const [i, sql] of MIGRATIONS.entries()) {
    const version = i + 1;
    if (version <= current) continue;
    d.transaction(() => {
      d.exec(sql);
      d.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
    })();
  }
}
