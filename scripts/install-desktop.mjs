// npm run install:desktop — (Windows) builds the NetRunner icon from public/netrunner-logo.svg and
// creates "NetRunner" shortcuts on the Desktop and in the Start menu. The shortcut runs the desktop
// app (src/desktop.ts) under a headless console, so there is no terminal window. Safe to re-run.
//   --icon-only   rebuild public/netrunner.ico without touching shortcuts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logo = path.join(appDir, 'public', 'netrunner-logo.svg');
const ico = path.join(appDir, 'public', 'netrunner.ico');
const SIZES = [256, 64, 48, 32, 16];

if (process.platform !== 'win32') {
  console.error('install:desktop is Windows-only. Elsewhere, run `npm start` (or Docker) and open the page.');
  process.exit(1);
}

const browser = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(b => fs.existsSync(b));

/** Logo centred on the app's dark tile (same colours as the config page). */
const tileHtml = size => `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.2)}px;background:radial-gradient(circle at 50% 35%,#2c1d20,#0c0809 70%);display:flex;align-items:center;justify-content:center;box-sizing:border-box;border:${Math.max(1, Math.round(size / 64))}px solid #ff6d3a55">
<img src="${pathToFileURL(logo)}" style="height:${size <= 32 ? 96 : 86}%;width:auto">
</div></body></html>`;

function renderPngs() {
  if (!browser) throw new Error('Edge or Chrome is needed to render the icon.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netrunner-icon-'));
  try {
    return SIZES.map(size => {
      const html = path.join(tmp, `tile-${size}.html`);
      const png = path.join(tmp, `tile-${size}.png`);
      fs.writeFileSync(html, tileHtml(size));
      execFileSync(browser, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
        `--user-data-dir=${path.join(tmp, 'profile')}`,
        '--default-background-color=00000000', `--window-size=${size},${size}`,
        `--screenshot=${png}`, pathToFileURL(html).href,
      ], { stdio: 'ignore', timeout: 60_000 });
      return { size, data: fs.readFileSync(png) };
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** ICO container with PNG-compressed entries (supported since Windows Vista). */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);   // colour planes
    e.writeUInt16LE(32, 6);  // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map(i => i.data)]);
}

function createShortcuts() {
  const target = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'conhost.exe');
  const args = `--headless "${process.execPath}" --import tsx src/desktop.ts`;
  const ps = `
$ws = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $lnk = $ws.CreateShortcut((Join-Path $dir 'NetRunner.lnk'))
  $lnk.TargetPath = '${target}'
  $lnk.Arguments = '${args.replace(/'/g, "''")}'
  $lnk.WorkingDirectory = '${appDir.replace(/'/g, "''")}'
  $lnk.IconLocation = '${ico.replace(/'/g, "''")},0'
  $lnk.Description = 'NetRunner news digest'
  $lnk.WindowStyle = 7
  $lnk.Save()
  Write-Output (Join-Path $dir 'NetRunner.lnk')
}`;
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' }).trim().split(/\r?\n/);
}

fs.writeFileSync(ico, buildIco(renderPngs()));
console.log(`✓ icon   ${path.relative(appDir, ico)} (${SIZES.join(', ')} px)`);
if (!process.argv.includes('--icon-only')) {
  for (const lnk of createShortcuts()) console.log(`✓ shortcut ${lnk}`);
  console.log('\nDouble-click NetRunner on your Desktop (or search "NetRunner" in Start). Closing its window stops it;');
  console.log('scheduled digests keep running through Windows Task Scheduler either way.');
}
