import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it } from 'vitest';
import { freshState } from './helpers.js';
import { normalizeConfig } from '../src/config/schema.js';
import { db } from '../src/db/db.js';
import { currentRun } from '../src/pipeline/run.js';
import { jobSpecs } from '../src/scheduler.js';
import { taskAction, taskXml, toPcClock } from '../src/schedule/windows.js';

describe('Windows Task Scheduler jobs', () => {
  const now = new Date(2026, 9, 8, 21, 0); // Thu 8 Oct 2026, 21:00 local
  const specs = jobSpecs(normalizeConfig({ schedule: { morningTime: '07:00', nightlyTime: '20:00', skipWeekends: true }, rollups: { weekly: true, monthly: true } }));
  const xmlFor = (name: string) => {
    const spec = specs.find(s => s.name === name)!;
    return taskXml(spec, spec.when, taskAction(spec.name, 'C:\\app', 'C:\\node\\node.exe'), 'PC\\zion', now);
  };

  it('weekday digests use a weekly trigger on Mon–Fri, starting at the next future slot', () => {
    const xml = xmlFor('morning digest');
    expect(xml).toContain('<StartBoundary>2026-10-09T07:00:00</StartBoundary>');
    expect(xml).toContain('<DaysOfWeek><Monday/><Tuesday/><Wednesday/><Thursday/><Friday/></DaysOfWeek>');
    // 20:00 already passed today → first run tomorrow, never an immediate fire on registration.
    expect(xmlFor('nightly digest')).toContain('<StartBoundary>2026-10-09T20:00:00</StartBoundary>');
  });

  it('monthly recap fires on the 28th of every month', () => {
    const xml = xmlFor('monthly recap');
    expect(xml).toContain('<DaysOfMonth><Day>28</Day></DaysOfMonth>');
    expect(xml.match(/<(January|December)\/>/g)).toHaveLength(2);
  });

  it('runs the CLI headless with the job name, catches up missed runs, and wakes the PC', () => {
    const xml = xmlFor('weekly rollup');
    expect(xml).toContain('<Command>conhost.exe</Command>');
    expect(xml).toContain('<Arguments>--headless &quot;C:\\node\\node.exe&quot; --import tsx src/cli.ts --job &quot;weekly rollup&quot;</Arguments>');
    expect(xml).toContain('<WorkingDirectory>C:\\app</WorkingDirectory>');
    expect(xml).toContain('<StartWhenAvailable>true</StartWhenAvailable>');
    expect(xml).toContain('<WakeToRun>true</WakeToRun>');
    expect(xml).toContain('<LogonType>InteractiveToken</LogonType>');
    expect(xml).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>');
  });

  it('converts the configured timezone to the PC clock, shifting days across midnight', () => {
    expect(toPcClock({ hour: 7, minute: 0 }, 'America/New_York', 'America/New_York')).toEqual({ hour: 7, minute: 0, shifted: false });
    const at = DateTime.fromISO('2026-10-08T12:00:00Z');
    expect(toPcClock({ hour: 7, minute: 30, days: [1, 2, 3, 4, 5] }, 'America/New_York', 'America/Los_Angeles', at))
      .toMatchObject({ hour: 4, minute: 30, days: [1, 2, 3, 4, 5], shifted: true });
    // 22:00 Sunday in New York is 03:00 Monday in Berlin.
    expect(toPcClock({ hour: 22, minute: 0, days: [0] }, 'America/New_York', 'Europe/Berlin', at))
      .toMatchObject({ hour: 4, minute: 0, days: [1] });
  });
});

describe('run lock (shared by the app and scheduled CLI runs)', () => {
  beforeEach(() => freshState());
  const hold = (pid: number, startedAt = new Date().toISOString()) =>
    db().prepare('INSERT OR REPLACE INTO run_lock (id, label, pid, started_at) VALUES (1, ?, ?, ?)').run('schedule:morning', pid, startedAt);

  it('a lock held by another live process blocks', () => {
    hold(process.ppid);
    expect(currentRun()).toBe('schedule:morning');
  });

  it('a lock left by a dead process, or older than 2 h, is ignored', () => {
    hold(999_999_999);
    expect(currentRun()).toBeNull();
    hold(process.ppid, new Date(Date.now() - 3 * 3600_000).toISOString());
    expect(currentRun()).toBeNull();
  });
});
