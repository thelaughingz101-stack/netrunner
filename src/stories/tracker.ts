// Port of n8n "Story Tracker", persisted in SQLite (stories + story_days) instead of story-tracker.json.
// Matching math is unchanged. Fixes (CHANGES_FROM_N8N.md): headlines come from feed items that were
// actually placed in sections (via their ids) plus untagged section bullets (search-sourced), never
// from the EXCLUDED ledger; "today" is in the configured timezone; developing stories are read
// BEFORE the prompt is built so they actually reach the nightly payload.
import { DateTime } from 'luxon';
import { db } from '../db/db.js';
import type { Item } from '../pipeline/types.js';

export const OVERLAP_THRESHOLD = 0.4;
export const DEVELOPING_MIN_DAYS = 3;
export const WINDOW_DAYS = 7;
const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','has','have','had','will','would',
  'could','should','may','might','its','it','this','that','from','by',
  'as','up','how','what','who','when','where','why','new','says','said',
  'after','over','about','into','than','more','also','just','not','no',
  'his','her','their','our','your','we','he','she','they',
]);

const keywords = (str: string) => str.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w));
export const overlap = (a: string, b: string) => {
  const sa = new Set(keywords(a));
  const sb = new Set(keywords(b));
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;
  const smaller = Math.min(sa.size, sb.size);
  return smaller > 0 ? shared / smaller : 0;
};
export const simpleHash = (str: string) => {
  let h = 0;
  for (const c of str) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return Math.abs(h).toString(36);
};

const cutoffDate = (today: string) => DateTime.fromISO(today).minus({ days: WINDOW_DAYS }).toISODate()!;
const cleanTitle = (t: string) => t.replace(/\s*\[SHORT\]\s*$/, '').trim();

interface StoryRow { id: string; title: string; first_seen: string; last_seen: string; days: number }

function storiesInWindow(today: string): StoryRow[] {
  return db().prepare(`
    SELECT s.id, s.title, s.first_seen, s.last_seen, COUNT(d.day) AS days
    FROM stories s JOIN story_days d ON d.story_id = s.id
    WHERE d.day >= ? GROUP BY s.id`).all(cutoffDate(today)) as StoryRow[];
}

/** "Developing" list in the exact line format Build LLM Payload expects. */
export function developingStories(today: string): string[] {
  return storiesInWindow(today)
    .filter(s => s.days >= DEVELOPING_MIN_DAYS)
    .sort((a, b) => b.days - a.days)
    .slice(0, 10)
    .map(s => `- "${s.title}" (seen ${s.days} days, first: ${s.first_seen})`);
}

/** Headlines for tracking: placed feed items + untagged bullets outside EXCLUDED (search-sourced). */
export function headlinesFromRun(items: Item[], placements: Map<string, string>, taggedDigest: string): string[] {
  const out: string[] = [];
  for (const i of items) {
    const p = placements.get(i.id!);
    if (p && p !== 'excluded' && i.title) out.push(cleanTitle(i.title));
  }
  // Same bullet regex the n8n node used, but only on lines with no id tag and not in EXCLUDED.
  const headlineRegex = /^-\s+(?:\[)?(?:\*\*)?([^\]*\n]{10,120})(?:\*\*)?(?:\])?/;
  let inExcluded = false;
  for (const line of taggedDigest.split('\n')) {
    if (/^##\s/.test(line)) { inExcluded = /EXCLUDED/i.test(line); continue; }
    if (inExcluded || /\[#N\d{3,}\]/.test(line)) continue;
    const m = line.match(headlineRegex);
    if (m && m[1].trim().length > 10) out.push(m[1].trim());
  }
  return [...new Set(out)];
}

/** Prune outside the window, match against known stories, add new ones. */
export function updateTracker(headlines: string[], today: string): { matched: number; created: number; tracked: number } {
  const d = db();
  let matched = 0, created = 0;
  d.transaction(() => {
    d.prepare('DELETE FROM story_days WHERE day < ?').run(cutoffDate(today));
    d.prepare('DELETE FROM stories WHERE id NOT IN (SELECT DISTINCT story_id FROM story_days)').run();
    const known = d.prepare('SELECT id, title FROM stories').all() as { id: string; title: string }[];
    const addDay = d.prepare('INSERT OR IGNORE INTO story_days (story_id, day) VALUES (?, ?)');
    for (const headline of headlines) {
      let best: { id: string; title: string } | null = null;
      let bestScore = 0;
      for (const s of known) {
        const score = overlap(headline, s.title);
        if (score >= OVERLAP_THRESHOLD && score > bestScore) { bestScore = score; best = s; }
      }
      if (best) {
        addDay.run(best.id, today);
        d.prepare('UPDATE stories SET title = ?, last_seen = ? WHERE id = ?').run(headline, today, best.id); // most recent wording
        best.title = headline;
        matched++;
      } else {
        const id = simpleHash(headline + today);
        d.prepare('INSERT OR IGNORE INTO stories (id, title, first_seen, last_seen) VALUES (?, ?, ?, ?)').run(id, headline, today, today);
        addDay.run(id, today);
        known.push({ id, title: headline });
        created++;
      }
    }
  })();
  const tracked = (d.prepare('SELECT COUNT(*) AS n FROM stories').get() as { n: number }).n;
  return { matched, created, tracked };
}

/** Stories for rollups: by days seen in [from, to]. */
export function storiesBetween(from: string, to: string) {
  return db().prepare(`
    SELECT s.id, s.title, s.first_seen AS firstSeen, s.last_seen AS lastSeen, COUNT(d.day) AS appearances
    FROM stories s JOIN story_days d ON d.story_id = s.id
    WHERE d.day BETWEEN ? AND ? GROUP BY s.id ORDER BY appearances DESC`).all(from, to) as
    { id: string; title: string; firstSeen: string; lastSeen: string; appearances: number }[];
}

/** One-time import of n8n's story-tracker.json, skipping the junk the old regex captured. */
export function importLegacyTracker(json: { stories?: { id: string; title: string; firstSeen: string; lastSeen: string; daysSeen: string[] }[] }) {
  let imported = 0, skipped = 0;
  const d = db();
  d.transaction(() => {
    for (const s of json.stories ?? []) {
      if (/—\s*rea(s(o(n)?)?)?:?/.test(s.title) || /\[SHORT$/.test(s.title) || /\(([^)]*)$/.test(s.title)) { skipped++; continue; }
      const res = d.prepare('INSERT OR IGNORE INTO stories (id, title, first_seen, last_seen) VALUES (?, ?, ?, ?)').run(s.id, cleanTitle(s.title), s.firstSeen, s.lastSeen);
      for (const day of s.daysSeen ?? []) d.prepare('INSERT OR IGNORE INTO story_days (story_id, day) VALUES (?, ?)').run(s.id, day);
      if (res.changes) imported++; else skipped++;
    }
  })();
  return { imported, skipped };
}
