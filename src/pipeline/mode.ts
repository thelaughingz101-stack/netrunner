// Port of n8n "Set Mode" (+ "Force Weekly Mode" / "Force Monthly Mode").
import { DateTime } from 'luxon';
import type { Config } from '../config/schema.js';
import type { Mode } from './types.js';

export interface ModeRequest {
  forceMode?: 'weekly' | 'monthly' | 'morning' | 'nightly';
  lookbackWindow?: string;
}

export type ModeDecision =
  | { skip: true; reason: string }
  | { skip: false; mode: Mode; lookbackWindow: string };

export function resolveMode(config: Config, req: ModeRequest = {}, now = new Date()): ModeDecision {
  const forceMode = req.forceMode;
  // Rollup disable check — applies no matter which trigger requested weekly/monthly
  if (forceMode === 'weekly' && config.rollups.weekly === false) return { skip: true, reason: 'weekly rollup disabled' };
  if (forceMode === 'monthly' && config.rollups.monthly === false) return { skip: true, reason: 'monthly rollup disabled' };

  const freq = config.schedule.frequency || 'twice_daily';
  const tz = config.schedule.timezone || 'America/New_York';
  let mode: Mode;
  if (forceMode) {
    // n8n only honored weekly/monthly here; morning/nightly are new so the scheduler can be explicit.
    mode = forceMode;
  } else if (freq === 'once_daily' || freq === 'weekly') {
    mode = 'morning';
  } else {
    const h = DateTime.fromJSDate(now).setZone(tz).hour;
    mode = h < 12 ? 'morning' : 'nightly';
  }
  // Lookback window: request override > saved config > default
  const lookbackWindow = req.lookbackWindow || config.schedule.lookbackWindow || '12h';
  return { skip: false, mode, lookbackWindow };
}

export const localDate = (now: Date, tz: string) => DateTime.fromJSDate(now).setZone(tz).toISODate()!;
