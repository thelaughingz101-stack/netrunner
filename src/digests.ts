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
  /** The run's Catch-up range (12h, 24h…), when the digest came from a run. */
  lookback: string | null;
  /** The grader's score and verdict (pass | attention | fail), when graded. */
  grade: { score: number; verdict: string } | null;
}

const map = (r: any): DigestRow => ({
  id: r.id, runId: r.run_id, date: r.date, mode: r.mode, content: r.content,
  dryRun: !!r.dry_run, source: r.source, extra: r.extra_json ? JSON.parse(r.extra_json) : null, createdAt: r.created_at,
  lookback: r.lookback ?? null,
  grade: r.grade_verdict ? { score: r.grade_score, verdict: r.grade_verdict } : null,
});

export function saveDigest(d: { runId?: string | null; date: string; mode: string; content: string; dryRun?: boolean; source?: string; extra?: object }): number {
  const info = db().prepare(
    'INSERT INTO digests (run_id, date, mode, content, dry_run, source, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(d.runId ?? null, d.date, d.mode, d.content, d.dryRun ? 1 : 0, d.source ?? 'run', d.extra ? JSON.stringify(d.extra) : null);
  return Number(info.lastInsertRowid);
}

export function listDigests(limit = 300): DigestRow[] {
  return db().prepare('SELECT d.*, r.lookback, g.score AS grade_score, g.verdict AS grade_verdict FROM digests d LEFT JOIN runs r ON r.id = d.run_id LEFT JOIN digest_grades g ON g.digest_id = d.id ORDER BY d.date DESC, d.id DESC LIMIT ?').all(limit).map(map);
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

export interface DigestHit { id: number; date: string; mode: string; matches: number; lines: string[] }

/** A digest line as plain text: "- [**Title**](url) — summary *(IGN)*" → "Title — summary (IGN)". */
const plainLine = (line: string) => line
  .replace(/^\s*[-*]\s+/, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_`]+/g, '')
  .trim();

/** Output tab search: saved digests whose text contains `q` (any case), newest first, with the matching lines. */
export function searchDigests(q: string, limit = 60): DigestHit[] {
  const needle = q.trim();
  if (!needle) return [];
  // "100%" means the text 100%, not a wildcard: % and _ are escaped (with !, LIKE's escape character here).
  const like = `%${needle.replace(/[!%_]/g, c => `!${c}`)}%`;
  const rows = db().prepare("SELECT id, date, mode, content FROM digests WHERE content LIKE ? ESCAPE '!' ORDER BY date DESC, id DESC LIMIT ?")
    .all(like, limit) as { id: number; date: string; mode: string; content: string }[];
  const lower = needle.toLowerCase();
  return rows.map(r => {
    const hits = r.content.split('\n').filter(l => !/^#/.test(l) && l.toLowerCase().includes(lower)).map(plainLine).filter(Boolean);
    return { id: r.id, date: r.date, mode: r.mode, matches: hits.length, lines: hits.slice(0, 3).map(l => (l.length > 220 ? `${l.slice(0, 220)}…` : l)) };
  }).filter(h => h.matches > 0);
}

export function digestById(id: number): DigestRow | undefined {
  const r = db().prepare('SELECT d.*, r.lookback FROM digests d LEFT JOIN runs r ON r.id = d.run_id WHERE d.id = ?').get(id);
  return r ? map(r) : undefined;
}
