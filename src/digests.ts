import { db } from './db/db.js';

export interface DigestRow {
  id: number;
  runId: string | null;
  date: string;
  mode: string;
  content: string;
  dryRun: boolean;
  source: string;
  extra: Record<string, unknown> | null;
  createdAt: string;
}

const map = (r: any): DigestRow => ({
  id: r.id, runId: r.run_id, date: r.date, mode: r.mode, content: r.content,
  dryRun: !!r.dry_run, source: r.source, extra: r.extra_json ? JSON.parse(r.extra_json) : null, createdAt: r.created_at,
});

export function saveDigest(d: { runId?: string | null; date: string; mode: string; content: string; dryRun?: boolean; source?: string; extra?: object }): number {
  const info = db().prepare(
    'INSERT INTO digests (run_id, date, mode, content, dry_run, source, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(d.runId ?? null, d.date, d.mode, d.content, d.dryRun ? 1 : 0, d.source ?? 'run', d.extra ? JSON.stringify(d.extra) : null);
  return Number(info.lastInsertRowid);
}

export function listDigests(limit = 300): DigestRow[] {
  return db().prepare('SELECT * FROM digests ORDER BY date DESC, id DESC LIMIT ?').all(limit).map(map);
}

export function deleteDigest(id: number): boolean {
  return db().prepare('DELETE FROM digests WHERE id = ?').run(id).changes > 0;
}

/** Latest non-dry-run digest for a date+mode — e.g. today's morning digest for nightly continuity. */
export function findDigest(date: string, mode: string): DigestRow | undefined {
  const r = db().prepare('SELECT * FROM digests WHERE date = ? AND mode = ? AND dry_run = 0 ORDER BY id DESC LIMIT 1').get(date, mode);
  return r ? map(r) : undefined;
}

/** Non-dry-run scheduled digests (morning/nightly) between two dates inclusive, oldest first. */
export function digestsBetween(from: string, to: string): DigestRow[] {
  return db().prepare(
    "SELECT * FROM digests WHERE date BETWEEN ? AND ? AND dry_run = 0 AND mode IN ('morning','nightly') ORDER BY date ASC, id ASC",
  ).all(from, to).map(map);
}
