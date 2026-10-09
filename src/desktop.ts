// The desktop app: starts the server, opens the config page in its own app window (Edge/Chrome
// --app mode, no tabs or address bar), and shuts the whole instance down when that window closes.
// Scheduled digests don't depend on this process: they are Windows Task Scheduler jobs.
//
// Launched by the NetRunner shortcut (npm run install:desktop) under a headless console, so there is
// no terminal window. Errors are shown in a message box instead.
//
// `--open "<path>"` opens the window on that page path, e.g. `/?digest=42` (used by scheduled runs when
// Delivery → "Open in NetRunner" is on).
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, env } from './env.js';
import { log } from './logger.js';
import { startServer } from './server/start.js';

const openArg = process.argv.indexOf('--open');
/** Only a same-origin path is accepted, never a full URL. */
const openPath = openArg > 0 && /^\/(?![/\\])/.test(process.argv[openArg + 1] ?? '') ? process.argv[openArg + 1] : '/';

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
];

/** Fallback shutdown: the page polls /api/health every 28 s. No request for this long = window gone. */
const IDLE_MS = 150_000;
/** A browser process that exits this fast handed the window to an already-running one. */
const HANDOFF_MS = 5_000;

// The text goes in through an environment variable, never spliced into the script: quotes, backslashes
// or line breaks in an error message can't break (or inject into) the PowerShell command.
function messageBox(text: string): void {
  const ps = "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($env:NETRUNNER_MSG, 'NetRunner', 'OK', 'Error') | Out-Null";
  execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, env: { ...process.env, NETRUNNER_MSG: text } });
}

async function alreadyRunning(url: string): Promise<boolean> {
  try { return (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

function openWindow(url: string) {
  const browser = BROWSERS.find(b => fs.existsSync(b));
  if (!browser) {
    // No Edge/Chrome: use the default browser. The idle watchdog still shuts down after the tab closes.
    spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, detached: true }).unref();
    return null;
  }
  // A dedicated profile makes this its own browser process, so its exit = the window was closed.
  return spawn(browser, [
    `--app=${url}`,
    `--user-data-dir=${path.join(dataDir(), 'app-window')}`,
    '--window-size=1280,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
  ], { stdio: 'ignore' });
}

async function main() {
  const e = env();
  const url = `http://127.0.0.1:${e.PORT}`;

  // Second double-click while NetRunner is open: just open another window onto it.
  if (await alreadyRunning(url)) {
    openWindow(url + openPath)?.unref();
    return;
  }

  const server = await startServer();
  let lastSeen = Date.now();
  server.app.server.on('request', () => { lastSeen = Date.now(); });

  const started = Date.now();
  const win = openWindow(server.url + openPath);
  // While we own the window's process, its exit is the shutdown signal. The idle watchdog is only for
  // when we can't see the window (default browser, or a hand-off): a minimized window's health poll can be
  // frozen by the browser for minutes, and the watchdog would shut down under a window that's still open.
  let watchdog = !win;
  win?.on('exit', () => {
    if (Date.now() - started < HANDOFF_MS) {
      log.warn('app window handed off to another browser process; falling back to the idle watchdog');
      lastSeen = Date.now();
      watchdog = true;
      return;
    }
    void server.shutdown('app window closed');
  });

  // Ticks that arrive late mean the PC was asleep; don't count that time as the page being gone.
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (now - lastTick > 30_000) lastSeen = now;
    lastTick = now;
    if (watchdog && now - lastSeen > IDLE_MS) void server.shutdown('no app window for 150 s');
  }, 10_000).unref();
}

main().catch(err => {
  const msg = (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
    ? `Port ${env().PORT} is already in use by another program. Close it, or set PORT in .env.`
    : `NetRunner could not start:\n\n${(err as Error).message}\n\nDetails are in data\\logs\\netrunner.log.`;
  log.fatal({ err }, 'desktop app failed to start');
  messageBox(msg);
  setTimeout(() => process.exit(1), 500);
});
