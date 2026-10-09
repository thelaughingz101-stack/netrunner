// Windows Task Scheduler backend: every scheduled job becomes a task under \NetRunner\ that runs the
// headless CLI (`cli.ts --job "<name>"`), so digests fire even when the app window is closed, can wake
// the PC from sleep, and a run missed while the PC was off starts at next boot (StartWhenAvailable).
// The task carries only the job name; the CLI looks up the current options from config when it fires.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { DateTime } from 'luxon';
import { dataDir } from '../env.js';
import { log } from '../logger.js';
import type { JobSpec, JobWhen } from '../scheduler.js';

const run = promisify(execFile);
export const TASK_FOLDER = 'NetRunner';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Task Scheduler runs on the PC clock. Convert a job's wall time from the configured timezone to the
 * PC's zone (no-op when they match, which is the normal case). Day lists shift when the conversion
 * crosses midnight.
 */
export function toPcClock(when: JobWhen, timezone: string, pcZone: string, now: DateTime = DateTime.now()):JobWhen & { shifted: boolean } {
  if (timezone === pcZone) return { ...when, shifted: false };
  const there = now.setZone(timezone).set({ hour: when.hour, minute: when.minute, second: 0, millisecond: 0 });
  const here = there.setZone(pcZone);
  const dayShift = (Date.UTC(here.year, here.month - 1, here.day) - Date.UTC(there.year, there.month - 1, there.day)) / 86_400_000;
  return {
    hour: here.hour,
    minute: here.minute,
    days: when.days?.map(d => (d + dayShift + 7) % 7),
    monthDay: when.monthDay,
    shifted: true,
  };
}

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = (n: number) => String(n).padStart(2, '0');

/** Next local occurrence of the time, so a freshly registered task never fires for a slot already past. */
function nextBoundary(when: JobWhen, now: Date): string {
  const d = new Date(now);
  d.setHours(when.hour, when.minute, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(when.hour)}:${pad(when.minute)}:00`;
}

function triggerXml(when: JobWhen, now: Date): string {
  const start = `<StartBoundary>${nextBoundary(when, now)}</StartBoundary>`;
  if (when.monthDay) {
    const months = MONTHS.map(m => `<${m}/>`).join('');
    return `<CalendarTrigger>${start}<ScheduleByMonth><DaysOfMonth><Day>${when.monthDay}</Day></DaysOfMonth><Months>${months}</Months></ScheduleByMonth></CalendarTrigger>`;
  }
  if (when.days) {
    const days = [...new Set(when.days)].sort().map(d => `<${DAY_NAMES[d]}/>`).join('');
    return `<CalendarTrigger>${start}<ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek>${days}</DaysOfWeek></ScheduleByWeek></CalendarTrigger>`;
  }
  return `<CalendarTrigger>${start}<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>`;
}

export interface TaskAction { command: string; args: string; workdir: string }

/** The command a task runs: the CLI under a headless console, so no window flashes up. */
export function taskAction(jobName: string, appDir = process.cwd(), nodePath = process.execPath): TaskAction {
  return {
    command: 'conhost.exe',
    args: `--headless "${nodePath}" --import tsx src/cli.ts --job "${jobName}"`,
    workdir: appDir,
  };
}

/** Pure: the Task Scheduler XML for one job (unit-tested). */
export function taskXml(spec: JobSpec, when: JobWhen, action: TaskAction, user: string, now = new Date()): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Author>NetRunner</Author><Description>${xmlEscape(`NetRunner ${spec.name}. Managed by the NetRunner app: change it from the Schedule tab, not here.`)}</Description></RegistrationInfo>
  <Principals><Principal id="Author"><UserId>${xmlEscape(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <WakeToRun>true</WakeToRun>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Triggers>${triggerXml(when, now)}</Triggers>
  <Actions Context="Author"><Exec><Command>${xmlEscape(action.command)}</Command><Arguments>${xmlEscape(action.args)}</Arguments><WorkingDirectory>${xmlEscape(action.workdir)}</WorkingDirectory></Exec></Actions>
</Task>`;
}

/** The account SID (S-1-5-21-…). Task Scheduler rejects DOMAIN\user for some Microsoft-account logins. */
async function currentUserSid(): Promise<string> {
  const { stdout } = await run(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
  const sid = stdout.match(/S-1-[\d-]+/)?.[0];
  if (!sid) throw new Error(`could not read the current user SID from whoami: ${stdout.trim()}`);
  return sid;
}

const schtasks = (...args: string[]) => run('schtasks.exe', args, { windowsHide: true });
const taskPath = (name: string) => `\\${TASK_FOLDER}\\${name}`;

async function registeredTasks(): Promise<string[]> {
  const { stdout } = await schtasks('/Query', '/FO', 'CSV', '/NH');
  const prefix = `"\\${TASK_FOLDER}\\`;
  return [...new Set(stdout.split(/\r?\n/).filter(l => l.startsWith(prefix)).map(l => l.slice(prefix.length, l.indexOf('"', 1))))];
}

// What we last registered, so re-syncing on every boot doesn't recreate unchanged tasks. Recreating
// resets a task's run history, which would cancel a pending "missed run, start at next boot" catch-up.
const stateFile = () => path.join(dataDir(), 'scheduled-tasks.json');
const readState = (): Record<string, string> => { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return {}; } };

/** Make \NetRunner\ match the job list exactly: create or update changed tasks, delete the rest. */
export async function syncWindowsTasks(specs: JobSpec[], timezone: string): Promise<void> {
  const pcZone = DateTime.local().zoneName;
  const user = await currentUserSid();
  const existing = new Set(await registeredTasks());
  const before = readState();
  const after: Record<string, string> = {};

  for (const spec of specs) {
    const when = toPcClock(spec.when, timezone, pcZone);
    if (when.shifted) log.warn({ job: spec.name, timezone, pcZone, pcTime: `${pad(when.hour)}:${pad(when.minute)}` }, 'schedule timezone differs from the PC clock; converted');
    const action = taskAction(spec.name);
    const sig = crypto.createHash('sha1').update(JSON.stringify({ when: { ...when, shifted: undefined }, action, user })).digest('hex');
    after[spec.name] = sig;
    if (existing.has(spec.name) && before[spec.name] === sig) continue;
    const file = path.join(os.tmpdir(), `netrunner-task-${process.pid}.xml`);
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(taskXml(spec, when, action, user), 'utf16le')]));
    try {
      await schtasks('/Create', '/XML', file, '/TN', taskPath(spec.name), '/F');
      log.info({ job: spec.name, at: `${pad(when.hour)}:${pad(when.minute)}` }, 'windows task registered');
    } finally {
      fs.rmSync(file, { force: true });
    }
  }
  for (const name of existing) {
    if (after[name]) continue;
    await schtasks('/Delete', '/TN', taskPath(name), '/F');
    log.info({ job: name }, 'windows task removed');
  }
  fs.writeFileSync(stateFile(), JSON.stringify(after, null, 2));
}

export interface TaskInfo { name: string; next: string | null; last: string | null; lastResult: number | null }

/** Next/last run per task, straight from Task Scheduler. */
export async function windowsTaskInfo(): Promise<TaskInfo[]> {
  const ps = `$ErrorActionPreference='SilentlyContinue'; @(Get-ScheduledTask -TaskPath '\\${TASK_FOLDER}\\' | ForEach-Object {
    $i = $_ | Get-ScheduledTaskInfo
    [pscustomobject]@{ name=$_.TaskName; next=$(if ($i.NextRunTime) { $i.NextRunTime.ToUniversalTime().ToString('o') }); last=$(if ($i.LastRunTime -and $i.LastRunTime.Year -gt 2000) { $i.LastRunTime.ToUniversalTime().ToString('o') }); lastResult=$i.LastTaskResult }
  }) | ConvertTo-Json -Compress`;
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout);
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  // 267011 = 0x41303 SCHED_S_TASK_HAS_NOT_RUN
  return (Array.isArray(parsed) ? parsed : [parsed]).map(t => ({
    name: t.name, next: str(t.next), last: str(t.last), lastResult: typeof t.lastResult === 'number' && t.lastResult !== 267011 ? t.lastResult : null,
  }));
}
