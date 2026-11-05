// The desktop app: starts the server, opens the config page in its own app window (Edge/Chrome
// --app mode, no tabs or address bar), and shuts the whole instance down when that window closes.
// Scheduled digests don't depend on this process: they are Windows Task Scheduler jobs.
//
// Launched by the NetRunner shortcut (npm run install:desktop) under a headless console, so there is
// no terminal window. Errors are shown in a message box instead.
//
// `--open "<path>"` opens the window on that page path, e.g. `/?digest=42` (used by scheduled runs when
// Delivery → "Open in NetRunner" is on).
//
// Opening took 10–20 s with nothing on screen (Zion, 2026-10-26): loading the app's code, unlocking the keys
// and starting the browser all happened before the window appeared. Now a tiny server answers on the port at
// once with a "Starting…" page, the window opens on it straight away, and the app's code loads meanwhile
// (imported only after the window is up); the page reloads itself into the app when the app answers.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** PORT, HOST and DATA_DIR without loading the app (env.ts unlocks the keys, which is slow): the environment, then .env. */
function address(): { port: number; host: string; dataDir: string } {
  let file = '';
  try { file = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8'); } catch { /* defaults */ }
  const setting = (k: string) => process.env[k]?.trim() || file.match(new RegExp(`^\\s*${k}\\s*=\\s*["']?([^"'\\s#]+)`, 'm'))?.[1];
  const port = Number(setting('PORT'));
  return { port: Number.isInteger(port) && port > 0 ? port : 8787, host: setting('HOST') || '127.0.0.1', dataDir: path.resolve(setting('DATA_DIR') || './data') };
}

const STARTING_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>NetRunner</title>
<style>html,body{height:100%;margin:0;background:#0c0809;color:#f3eeec;font-family:'IBM Plex Sans','Segoe UI',sans-serif}
main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
h1{font:700 34px 'Rajdhani','Segoe UI',sans-serif;letter-spacing:.04em;margin:0}
.bar{width:220px;height:3px;background:#1a1214;overflow:hidden;border-radius:2px}
.bar i{display:block;width:40%;height:100%;background:#ff6d3a;box-shadow:0 0 10px #ff6d3a;animation:s 1.1s ease-in-out infinite}
@keyframes s{0%{transform:translateX(-110%)}100%{transform:translateX(260%)}}
p{color:#857579;font-size:14px;margin:0}</style></head>
<body><main><h1>NETRUNNER</h1><div class="bar"><i></i></div><p id="m">Starting…</p></main>
<script>const t0=Date.now();(async function poll(){try{const r=await fetch('/api/health',{cache:'no-store'});if(r.ok)return location.reload();}catch(e){}
if(Date.now()-t0>60000)document.getElementById('m').textContent='Taking longer than usual. If an error box opened, follow what it says.';setTimeout(poll,400);})();</script>
</body></html>`;

/** Answers on the app's port until the app takes over: the "Starting…" page, and 503 for the API. */
function startingServer(port: number, host: string): Promise<http.Server | null> {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/')) { res.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(STARTING_PAGE);
  });
  const attempt = () => new Promise<boolean>(resolve => {
    server.once('error', () => resolve(false));
    server.listen(port, host, () => resolve(true));
  });
  // A NetRunner that's just been closed can hold the port for a few seconds while it shuts down. Opening the
  // window then showed "127.0.0.1 refused to connect" until the new one was up (Zion, 2026-10-26): wait instead.
  return (async () => {
    for (const until = Date.now() + 15_000; ;) {
      if (await attempt()) return server;
      if (Date.now() > until) return null; // still taken: the app's own start reports it
      await new Promise(r => setTimeout(r, 250));
    }
  })();
}

function stopServer(server: http.Server | null): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
}

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

function openWindow(url: string, dataDir: string) {
  const browser = BROWSERS.find(b => fs.existsSync(b));
  if (!browser) {
    // No Edge/Chrome: use the default browser. The idle watchdog still shuts down after the tab closes.
    spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, detached: true }).unref();
    return null;
  }
  // A dedicated profile makes this its own browser process, so its exit = the window was closed.
  return spawn(browser, [
    `--app=${url}`,
    `--user-data-dir=${path.join(dataDir, 'app-window')}`,
    '--window-size=1280,900',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-mode',
  ], { stdio: 'ignore' });
}

async function main() {
  const { port, host, dataDir } = address();
  const url = `http://127.0.0.1:${port}`;

  // Second double-click while NetRunner is open: just open another window onto it.
  if (await alreadyRunning(url)) {
    openWindow(url + openPath, dataDir)?.unref();
    return;
  }

  // The window first, on the "Starting…" page; then the app (its code is only loaded now).
  const starting = await startingServer(port, host);
  const started = Date.now();
  const win = openWindow(url + openPath, dataDir);
  let closedEarly = false;
  win?.once('exit', () => { if (Date.now() - started >= HANDOFF_MS) closedEarly = true; });

  const { startServer } = await import('./server/start.js');
  const { log } = await import('./logger.js');
  const server = await startServer([], () => stopServer(starting));
  if (closedEarly) return void server.shutdown('app window closed while starting');
  let lastSeen = Date.now();
  server.app.server.on('request', () => { lastSeen = Date.now(); });

  // While we own the window's process, its exit is the shutdown signal. The idle watchdog is only for
  // when we can't see the window (default browser, or a hand-off): a minimized window's health poll can be
  // frozen by the browser for minutes, and the watchdog would shut down under a window that's still open.
  let watchdog = !win || win.exitCode !== null;
  if (win && win.exitCode !== null) log.warn('app window handed off to another browser process; falling back to the idle watchdog');
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

main().catch(async err => {
  // Loaded here, not up top: the window must not wait for them. If they can't load, the box still shows.
  const db = await import('./db/db.js').catch(() => null);
  const envModule = await import('./env.js').catch(() => null);
  const msg = envModule && err instanceof envModule.EnvError
    ? `NetRunner could not start because a setting in .env has a value it can't use:\n\n${err.issues.map(i => `${i.key}: ${i.message}`).join('\n')}\n\nFix it in .env (in the NetRunner folder) and open NetRunner again.`
    : (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
      ? `Port ${address().port} is already in use by another program. Close it, or set PORT in .env.`
      : db?.isNativeBuildError(err)
        ? `NetRunner could not start because its database engine isn't installed for this version of Node.js (${process.version}). That happens when Setup didn't finish, or after Node.js was updated.\n\nTo repair it, double-click "Setup NetRunner" in the NetRunner folder:\n${appDir}`
        : `NetRunner could not start:\n\n${(err as Error).message}\n\nDetails are in data\\logs\\netrunner.log.`;
  try { (await import('./logger.js')).log.fatal({ err }, 'desktop app failed to start'); } catch { /* the message box still shows */ }
  messageBox(msg);
  setTimeout(() => process.exit(1), 500);
});

