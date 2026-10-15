// Run by "Setup NetRunner.cmd" before installing: which folder should NetRunner live in?
//   - Already installed somewhere (and it has run): update that install in place instead of making a second
//     one. The new version's files are copied over it; its .env (settings), data (database, digests,
//     encrypted keys) and anything else not part of a release are kept.
//   - Not installed yet: ask where to install it (default %USERPROFILE%\NetRunner, outside OneDrive and
//     Google Drive), copy the release there, and carry on in that folder. The download can then be deleted.
// The install is found from install.json (written by install:desktop), or, for installs made before that
// existed, from the NetRunner Desktop shortcut.
//
//   node scripts/setup-update.mjs <file>   writes the folder to install into to <file>
//   exit 0 = carry on there, exit 2 = stop (the reason is printed)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Never copied from a release folder, and never touched in the install. */
export const KEEP = new Set(['.env', 'data', 'node_modules', 'reference', '.git', 'desktop.ini']);

export const markerFile = (localAppData = process.env.LOCALAPPDATA ?? '') => path.join(localAppData, 'NetRunner', 'install.json');

/** Where a new install goes unless the user picks another folder: their user folder, which isn't synced. */
export const defaultInstallDir = (home = os.homedir()) => path.join(home, 'NetRunner');

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

/** Why this release can't update that install (printed as lines), or null if it can. */
export function updateRefusal(found, releaseVersion) {
  if (found.git) return [
    `NetRunner is already installed at ${found.dir}`,
    'That copy is a developer (git) checkout, so Setup will not overwrite it.',
    'Update it with "git pull" there, then run "npm ci" and "npm run install:desktop".',
  ];
  if (compareVersions(releaseVersion, found.version) < 0) return [
    `NetRunner ${found.version} is installed at ${found.dir}`,
    `This download is an older version (${releaseVersion}), so nothing was changed.`,
  ];
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

/** A typed or picked folder → the folder NetRunner goes in: "\NetRunner" is added unless it already ends in it. */
export function installDirFor(input) {
  const dir = path.resolve(input);
  return path.basename(dir).toLowerCase() === 'netrunner' ? dir : path.join(dir, 'NetRunner');
}

/**
 * The cloud service syncing this folder, if any. NetRunner's database and app-window cache change all the
 * time, and a synced install made the app lag (Google Drive was backing it up).
 */
export function syncedBy(dir, env = process.env) {
  const lower = path.resolve(dir).toLowerCase() + path.sep;
  for (const v of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    if (env[v] && lower.startsWith(path.resolve(env[v]).toLowerCase() + path.sep)) return 'OneDrive';
  }
  const named = lower.match(/[\\/](onedrive|my drive|google drive|dropbox|iclouddrive)( - [^\\/]*)?[\\/]/);
  if (!named) return null;
  return { onedrive: 'OneDrive', 'my drive': 'Google Drive', 'google drive': 'Google Drive', dropbox: 'Dropbox', iclouddrive: 'iCloud' }[named[1]];
}

/** What's at a chosen install folder. */
export function folderState(dir) {
  if (!fs.existsSync(dir)) return 'new';
  if (readPackage(dir)) return 'netrunner';
  return fs.readdirSync(dir).some(f => f !== 'desktop.ini') ? 'occupied' : 'empty';
}

const unquote = s => s.trim().replace(/^"(.*)"$/, '$1').trim();

/**
 * Asks where to install until the answer is a folder NetRunner can go in, then puts the release there and
 * returns it. Enter accepts the suggested folder; B (browse) or a typed path replaces the suggestion, and is
 * shown again so the user sees the final folder (with \NetRunner added) before accepting it.
 */
export async function chooseFolder({ releaseDir, releaseVersion, suggested, ask, browse, say, env = process.env }) {
  for (;;) {
    say('');
    say(`    ${suggested}`);
    say('');
    say('Press Enter to use this folder,');
    say('B to browse for a different one,');
    say('or paste a folder path and press Enter.');
    const answer = unquote(await ask('  > '));
    if (/^b$/i.test(answer)) {
      const picked = browse(path.dirname(suggested));
      if (picked) suggested = installDirFor(picked);
      continue;
    }
    if (answer) {
      if (!/^[a-z]:[\\/]|^\\\\/i.test(answer)) say('Type the whole path, starting with the drive, like D:\\Apps');
      else suggested = installDirFor(answer);
      continue;
    }

    const dir = suggested;
    if (samePath(dir, releaseDir)) return dir;
    if (!fs.existsSync(path.parse(dir).root)) { say(`There is no ${path.parse(dir).root} drive on this PC. Choose another folder.`); continue; }
    const state = folderState(dir);
    if (state === 'occupied') { say(`${dir} already has other files in it. Choose an empty folder or a new one.`); continue; }
    if (state === 'netrunner') {
      const found = findExistingInstall([dir], releaseDir);
      const refusal = updateRefusal(found, releaseVersion);
      if (refusal) { refusal.forEach(l => say(l)); say('Choose another folder.'); continue; }
    }
    const sync = syncedBy(dir, env);
    if (sync) {
      say(`That folder is synced by ${sync}. NetRunner's database and window cache change all the time,`);
      say(`which slows ${sync} and makes NetRunner lag.`);
      if (!/^y/i.test(await ask('  Use it anyway? (Y/N) '))) continue;
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      say(state === 'netrunner' ? `Updating the NetRunner in ${dir}. Its settings, keys and digests are kept.` : `Copying NetRunner to ${dir}...`);
      copyRelease(releaseDir, dir);
      return dir;
    } catch (err) {
      say(`That folder can't be used: ${explain(err)}`);
    }
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

/** The Windows folder picker, kept on top of the Setup window. Returns null if it was cancelled. */
function browseForFolder(start) {
  const ps = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Choose where to put NetRunner. A NetRunner folder is made inside the one you pick.'
$d.ShowNewFolderButton = $true
$d.SelectedPath = $env:NETRUNNER_START
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
if ($d.ShowDialog($owner) -eq 'OK') { $d.SelectedPath }`;
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', ps],
      { encoding: 'utf8', env: { ...process.env, NETRUNNER_START: start } }).trim() || null;
  } catch { return null; }
}

function markerDir() {
  try { return JSON.parse(fs.readFileSync(markerFile(), 'utf8')).dir; } catch { return null; }
}

async function main(outFile) {
  const release = readPackage(here);
  const proceed = dir => { fs.writeFileSync(outFile, dir, 'utf8'); process.exit(0); };
  const say = s => console.log(s ? `        ${s}` : '');
  const step = s => console.log(`  [2/5] ${s}`);
  // This folder is itself an install (it has its own digests, or the shortcuts already run it), e.g. Setup
  // is re-run to repair it or to re-point the shortcuts after a move: repair it here.
  const candidates = [markerDir(), ...shortcutDirs()];
  if (isInstall(here) || candidates.some(d => d && samePath(d, here))) {
    step('Repairing NetRunner in this folder...');
    return proceed(here);
  }
  const found = findExistingInstall(candidates, here);
  if (found && (found.git || isInstall(found.dir))) {
    step('Updating your NetRunner...');
    const refusal = updateRefusal(found, release.version);
    if (refusal) { refusal.forEach(l => say(l)); process.exit(2); }
    say(`Found NetRunner ${found.version} at ${found.dir}`);
    say(`Updating it to ${release.version}. Your settings, keys and digests are kept.`);
    copyRelease(here, found.dir);
    return proceed(found.dir);
  }

  step('Where should NetRunner live?');
  // A copy that never ran has nothing to keep, so it doesn't decide where NetRunner goes.
  if (found) say(`(The NetRunner at ${found.dir} never ran. You can delete it once Setup is DONE.)`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    proceed(await chooseFolder({
      releaseDir: here, releaseVersion: release.version, suggested: defaultInstallDir(),
      ask: q => rl.question(q), browse: browseForFolder, say,
    }));
  } finally { rl.close(); }
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
  main(process.argv[2]).catch(err => {
    console.log(`        Setup stopped because ${explain(err)}`);
    process.exit(1);
  });
}
