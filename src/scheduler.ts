// Replaces n8n's "Morning and Nightly Trigger" / "Weekly Trigger" / "Monthly Trigger".
// Unlike n8n (hardcoded 7:00/20:00), the times, timezone, frequency and skipWeekends come from the
// Config UI's Schedule tab, and jobs are rebuilt whenever the config is saved.
//
// Two backends (env SCHEDULER):
//  - windows:  jobs are registered with Windows Task Scheduler (src/schedule/windows.ts), so they fire
//              even when the app is closed. The server only syncs them; it never fires them itself.
//  - internal: node-cron inside the server process (Docker / Pi, where the server runs 24/7).
import cron, { type ScheduledTask } from 'node-cron';
import type { Config } from './config/schema.js';
import { getConfig, onConfigChange } from './config/store.js';
import { env } from './env.js';
import { log } from './logger.js';
import { run, RunInProgressError, type RunOptions } from './pipeline/run.js';
import { syncWindowsTasks, windowsTaskInfo } from './schedule/windows.js';

/** Wall-clock time in the configured timezone. days: 0=Sun…6=Sat (omitted = every day). */
export interface JobWhen {
  hour: number;
  minute: number;
  days?: number[];
  monthDay?: number;
}

export interface JobSpec {
  name: string;
  cron: string;
  when: JobWhen;
  opts: Omit<RunOptions, 'trigger'>;
}

const at = (hhmm: string) => {
  const [hour, minute] = hhmm.split(':').map(Number);
  return { hour, minute };
};

const toCron = (w: JobWhen) =>
  `${w.minute} ${w.hour} ${w.monthDay ?? '*'} * ${w.days ? (w.days.join(',') === '1,2,3,4,5' ? '1-5' : w.days.join(',')) : '*'}`;

const job = (name: string, when: JobWhen, opts: JobSpec['opts']): JobSpec => ({ name, cron: toCron(when), when, opts });

/** Pure: config → job list (unit-tested). */
export function jobSpecs(config: Config): JobSpec[] {
  const s = config.schedule;
  // Scheduling switched off: no jobs at all, so the Windows tasks are deleted on the next sync.
  if (s.enabled === false) return [];
  const days = s.skipWeekends ? [1, 2, 3, 4, 5] : undefined;
  const jobs: JobSpec[] = [];

  if (s.frequency === 'twice_daily' || s.frequency === 'once_daily') {
    jobs.push(job('morning digest', { ...at(s.morningTime), days }, { forceMode: 'morning' }));
  }
  if (s.frequency === 'twice_daily') {
    jobs.push(job('nightly digest', { ...at(s.nightlyTime), days }, { forceMode: 'nightly' }));
  }
  if (s.frequency === 'weekly') {
    // "Weekly — Sunday digest only": one digest on Sunday at the morning time, covering the week.
    jobs.push(job('weekly digest', { ...at(s.morningTime), days: [0] }, { forceMode: 'morning', lookbackWindow: '1w' }));
  }
  // Rollups keep n8n's trigger times: Weekly = Sundays 12:00, Monthly = the 28th at 22:00.
  if (config.rollups.weekly) jobs.push(job('weekly rollup', { hour: 12, minute: 0, days: [0] }, { forceMode: 'weekly' }));
  if (config.rollups.monthly) jobs.push(job('monthly recap', { hour: 22, minute: 0, monthDay: 28 }, { forceMode: 'monthly' }));
  return jobs;
}

let tasks: { spec: JobSpec; task: ScheduledTask }[] = [];
let syncing: Promise<void> = Promise.resolve();

export function startScheduler(config: Config = getConfig().config): void {
  stopScheduler();
  const backend = env().SCHEDULER;
  if (backend === 'windows' || backend === 'off') {
    // Serialize syncs so two quick saves can't interleave schtasks calls.
    const specs = backend === 'off' ? [] : jobSpecs(config);
    syncing = syncing
      .then(() => syncWindowsTasks(specs, config.schedule.timezone))
      .finally(() => { taskInfoCache = null; })
      .then(() => log.info({ backend, jobs: specs.map(s => `${s.name} @ ${s.cron}`) }, 'schedule synced to Windows Task Scheduler'))
      .catch(err => log.error({ err: (err as Error).message }, 'could not sync Windows Task Scheduler'));
    return;
  }
  const tz = config.schedule.timezone;
  for (const spec of jobSpecs(config)) {
    const task = cron.schedule(spec.cron, async () => {
      log.info({ job: spec.name }, 'scheduled run firing');
      try {
        await run({ trigger: 'schedule', ...spec.opts });
      } catch (err) {
        if (err instanceof RunInProgressError) log.warn({ job: spec.name }, 'scheduled run skipped — another run is in progress');
        else log.error({ job: spec.name, err: (err as Error).message }, 'scheduled run failed');
      }
    }, { timezone: tz, name: spec.name });
    tasks.push({ spec, task });
  }
  log.info({ timezone: tz, jobs: tasks.map(({ spec, task }) => ({ name: spec.name, next: task.getNextRun()?.toISOString() ?? null })) }, 'scheduler started');
}

export function stopScheduler(): void {
  for (const { task } of tasks) task.stop();
  tasks = [];
}

// Reading task info means starting powershell.exe (~1 s of CPU), and the Schedule tab polls every 30 s.
// Cached for a few minutes; dropped whenever a sync changes the tasks.
const TASK_INFO_TTL_MS = 5 * 60_000;
let taskInfoCache: { at: number; jobs: Promise<Awaited<ReturnType<typeof windowsTaskInfo>>> } | null = null;

function cachedTaskInfo() {
  if (!taskInfoCache || Date.now() - taskInfoCache.at > TASK_INFO_TTL_MS) {
    const jobs = windowsTaskInfo();
    taskInfoCache = { at: Date.now(), jobs };
    jobs.catch(() => { taskInfoCache = null; }); // don't cache a failure
  }
  return taskInfoCache.jobs;
}

/** Waits for any in-flight Task Scheduler sync (shutdown, tests). */
export const schedulerSettled = () => syncing;

export async function nextRuns(): Promise<{ backend: string; jobs: { name: string; cron?: string; next: string | null; last?: string | null; lastResult?: number | null }[] }> {
  const backend = env().SCHEDULER;
  if (backend !== 'internal') {
    await syncing;
    try { return { backend, jobs: await cachedTaskInfo() }; } catch { return { backend, jobs: [] }; }
  }
  return { backend, jobs: tasks.map(({ spec, task }) => ({ name: spec.name, cron: spec.cron, next: task.getNextRun()?.toISOString() ?? null })) };
}

/** Reschedule whenever the Config UI saves. */
export function watchConfig(): void {
  onConfigChange(c => startScheduler(c));
}
