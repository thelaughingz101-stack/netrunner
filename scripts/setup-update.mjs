// Run by "Setup NetRunner.cmd" before installing: is NetRunner already installed somewhere else?
//   - No: install in this folder, as before.
//   - Yes: update that install in place instead of making a second one. The new version's files are
//     copied over it; its .env (settings), data (database, digests, encrypted keys) and anything else not
//     part of a release are kept. Setup then carries on in that folder.
// The install is found from install.json (written by install:desktop), or, for installs made before that
// existed, from the NetRunner Desktop shortcut.
//
//   node scripts/setup-update.mjs <file>   writes the folder to install into to <file>
//   exit 0 = carry on there, exit 2 = stop (the reason is printed)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Never copied from a release folder, and never touched in the install. */
export const KEEP = new Set(['.env', 'data', 'node_modules', 'reference', '.git', 'desktop.ini']);

export const markerFile = (localAppData = process.env.LOCALAPPDATA ?? '') => path.join(localAppData, 'NetRunner', 'install.json');

/** "1.0.10" > "1.0.9". Returns <0, 0, >0. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function readPackage(dir) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return p.name === 'netrunner' ? p : null;
  } catch { return null; }
}

/** A folder NetRunner has run from (a release zip never contains data). */
export const isInstall = dir => fs.existsSync(path.join(dir, 'data', 'netrunner.db'));

const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** The other NetRunner install to update, if any. Candidates come from install.json, then the shortcuts. */
export function findExistingInstall(candidates, releaseDir) {
  for (const dir of candidates) {
    if (!dir || samePath(dir, releaseDir)) continue;
    const pkg = readPackage(dir);
    if (pkg) return { dir: path.resolve(dir), version: pkg.version, git: fs.existsSync(path.join(dir, '.git')) };
  }
  return null;
}

/** Copies the release's files over the install. Release folders replace the old ones (so deleted files go). */
export function copyRelease(releaseDir, installDir) {
  for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
    if (KEEP.has(entry.name)) continue;
    const from = path.join(releaseDir, entry.name), to = path.join(installDir, entry.name);
    if (entry.isDirectory()) fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true, force: true, filter: src => path.basename(src) !== 'desktop.ini' });
  }
}

function shortcutDirs() {
  if (process.platform !== 'win32') return [];
  const ps = `$ws = New-Object -ComObject WScript.Shell
foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $p = Join-Path $d 'NetRunner.lnk'
  if (Test-Path -LiteralPath $p) { $ws.CreateShortcut($p).WorkingDirectory }
}`;
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true })
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch { return []; }
}

function markerDir() {
  try { return JSON.parse(fs.readFileSync(markerFile(), 'utf8')).dir; } catch { return null; }
}

function main(outFile) {
  const release = readPackage(here);
  const proceed = dir => { fs.writeFileSync(outFile, dir, 'utf8'); process.exit(0); };
  // This folder is itself an install (it has its own digests), e.g. it was moved or copied and Setup is
  // run to re-point the shortcuts: repair it here rather than update some other copy.
  if (isInstall(here)) return proceed(here);
  const found = findExistingInstall([markerDir(), ...shortcutDirs()], here);
  if (!found) return proceed(here);

  const say = s => console.log(`        ${s}`);
  if (found.git) {
    say(`NetRunner is already installed at ${found.dir}`);
    say('That copy is a developer (git) checkout, so Setup will not overwrite it.');
    say('Update it with "git pull" there, then run "npm ci" and "npm run install:desktop".');
    process.exit(2);
  }
  if (compareVersions(release.version, found.version) < 0) {
    say(`NetRunner ${found.version} is installed at ${found.dir}`);
    say(`This download is an older version (${release.version}), so nothing was changed.`);
    process.exit(2);
  }
  say(`Found NetRunner ${found.version} at ${found.dir}`);
  say(`Updating it to ${release.version}. Your settings, keys and digests are kept.`);
  copyRelease(here, found.dir);
  proceed(found.dir);
}

/** Why a file operation failed, in plain words. */
export function explain(err) {
  const where = err.path ? ` (${err.path.replace(/^\\\\\?\\/, '')})` : '';
  switch (err.code) {
    case 'EBUSY': case 'EPERM': return `a file is open in another program${where}. Close NetRunner, any editor or Explorer window showing its folder, and try again.`;
    case 'EACCES': return `Windows refused access${where}. Make sure you can change files in that folder.`;
    case 'ENOSPC': return 'the disk is full. Free up some space and try again.';
    case 'ENOENT': return `a file went missing while copying${where}. Extract the download again and re-run Setup from there.`;
    default: return err.message || String(err);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv[2]); }
  catch (err) {
    console.log(`        Updating your existing NetRunner stopped because ${explain(err)}`);
    process.exit(1);
  }
}
