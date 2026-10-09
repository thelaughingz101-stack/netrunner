// One-time import of n8n-era history into the NetRunner DB:
//   npm run import:n8n -- [path/to/.n8n-files]   (default: ~/.n8n-files)
// - digests:  YYYY-MM-DD-(morning|nightly).md  and  digest-YYYY-MM-DD-HH-mm-<mode>.txt
// - story tracker: story-tracker.json (junk entries from the old regex are skipped)
// Safe to re-run: identical digests are not imported twice.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from '../src/db/db.js';
import { saveDigest } from '../src/digests.js';
import { importLegacyTracker } from '../src/stories/tracker.js';

const dir = path.resolve(process.argv[2] ?? path.join(os.homedir(), '.n8n-files'));
if (!fs.existsSync(dir)) {
  console.error(`not found: ${dir}`);
  process.exit(1);
}

const PATTERNS = [
  /^(\d{4}-\d{2}-\d{2})-(morning|nightly|weekly|monthly)\.md$/,
  /^digest-(\d{4}-\d{2}-\d{2})-\d{2}-\d{2}-(morning|nightly|weekly|monthly)\.(?:txt|md)$/,
];
const exists = db().prepare('SELECT 1 FROM digests WHERE date = ? AND mode = ? AND content = ?');

let imported = 0, skipped = 0;
for (const name of fs.readdirSync(dir).sort()) {
  const m = PATTERNS.map(p => name.match(p)).find(Boolean);
  if (!m) continue;
  const content = fs.readFileSync(path.join(dir, name), 'utf8').replace(/^﻿/, '').trim();
  if (content.length < 50 || exists.get(m[1], m[2], content)) { skipped++; continue; }
  saveDigest({ date: m[1], mode: m[2], content, source: 'import' });
  imported++;
}
console.log(`digests: ${imported} imported, ${skipped} skipped (empty or already present)`);

const trackerPath = path.join(dir, 'story-tracker.json');
if (fs.existsSync(trackerPath)) {
  const r = importLegacyTracker(JSON.parse(fs.readFileSync(trackerPath, 'utf8')));
  console.log(`story tracker: ${r.imported} stories imported, ${r.skipped} skipped (junk from the old regex, or already present)`);
}
db().close();
