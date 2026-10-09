import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../db/db.js';
import { dataDir } from '../../env.js';
import type { RunContext } from '../types.js';
import { discord, email, file } from './targets.js';
import type { DeliveryInput, DeliveryTarget } from './types.js';

/** Every delivery target, each independently toggled in the Config UI's Delivery tab. */
export const TARGETS: DeliveryTarget[] = [discord(), email(), file()];

export interface DeliveryResult {
  target: string;
  status: 'sent' | 'skipped' | 'dry-run' | 'error';
  detail: string;
}

/**
 * Runs each enabled target independently — one failing never blocks the others.
 * Dry run: renders exactly what would be sent into data/dry-run/<runId>/ and sends nothing.
 */
export async function deliverAll(input: DeliveryInput, ctx: RunContext, targets: DeliveryTarget[] = TARGETS): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];
  const previewDir = path.join(dataDir(), 'dry-run', ctx.runId);
  for (const t of targets) {
    let r: DeliveryResult;
    if (!t.enabled(ctx.config)) {
      r = { target: t.name, status: 'skipped', detail: 'disabled in config' };
    } else {
      const bad = t.misconfigured(ctx.config);
      if (bad && !ctx.dryRun) {
        r = { target: t.name, status: 'error', detail: bad };
      } else {
        try {
          const rendered = t.render(input, ctx);
          if (ctx.dryRun) {
            fs.mkdirSync(previewDir, { recursive: true });
            for (const [name, content] of Object.entries(rendered.preview)) fs.writeFileSync(path.join(previewDir, `${t.name}-${name}`), content, 'utf8');
            r = { target: t.name, status: 'dry-run', detail: `would send ${rendered.summary}${bad ? ` (and would fail: ${bad})` : ''} — preview in ${previewDir}` };
          } else {
            r = { target: t.name, status: 'sent', detail: await rendered.send() };
          }
        } catch (err) {
          r = { target: t.name, status: 'error', detail: (err as Error).message };
        }
      }
    }
    results.push(r);
    db().prepare('INSERT INTO deliveries (run_id, target, status, detail) VALUES (?, ?, ?, ?)').run(ctx.runId, r.target, r.status, r.detail);
    (r.status === 'error' ? ctx.log.error : ctx.log.info).call(ctx.log, { target: r.target, status: r.status, detail: r.detail }, `delivery: ${r.target} ${r.status}`);
  }
  ctx.stats.delivery = results;
  return results;
}
