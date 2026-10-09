// npm run digest -- [--dry-run] [--mode morning|nightly|weekly|monthly] [--lookback 12h|24h|3d|1w|2w|1mo] [--prompt]
// Windows Task Scheduler runs: cli.ts --job "<job name>"  (options come from the current config's schedule)
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { getConfig } from './config/store.js';
import { db } from './db/db.js';
import { log } from './logger.js';
import { run, RunInProgressError, runPrompt, type RunOptions } from './pipeline/run.js';
import { jobSpecs } from './scheduler.js';

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    mode: { type: 'string' },
    lookback: { type: 'string' },
    prompt: { type: 'boolean', default: false },
    job: { type: 'string' },
  },
});

/** After waking from sleep the network can take a little while to come back. */
async function waitForNetwork(maxMs = 3 * 60_000): Promise<void> {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    try { await lookup('generativelanguage.googleapis.com'); return; } catch { await sleep(10_000); }
  }
  log.warn('network still unreachable after waiting; running anyway');
}

/** A scheduled run that finds another run in progress waits its turn instead of being dropped. */
async function runWhenFree(opts: RunOptions, maxMs = 45 * 60_000) {
  const until = Date.now() + maxMs;
  for (;;) {
    try { return await run(opts); } catch (err) {
      if (!(err instanceof RunInProgressError) || Date.now() > until) throw err;
      log.info({ job: values.job }, 'another run is in progress; waiting');
      await sleep(30_000);
    }
  }
}

/** Delivery → "Open in NetRunner": start the desktop app (or a window onto the running one) on this digest. */
function openInApp(digestId: number) {
  try {
    spawn(process.execPath, ['--import', 'tsx', 'src/desktop.ts', '--open', `/?digest=${digestId}`], {
      cwd: process.cwd(), detached: true, stdio: 'ignore', windowsHide: true,
    }).unref();
    log.info({ digestId }, 'opened the digest in the NetRunner app');
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'could not open the NetRunner app');
  }
}

async function main() {
  if (values.job) {
    const spec = jobSpecs(getConfig().config).find(j => j.name === values.job);
    if (!spec) {
      log.warn({ job: values.job }, 'scheduled job no longer in config; nothing to do');
      return;
    }
    log.info({ job: spec.name }, 'scheduled run firing (Windows Task Scheduler)');
    await waitForNetwork();
    const out = await runWhenFree({ trigger: 'schedule', ...spec.opts });
    if (out.kind !== 'skipped' && getConfig().config.delivery.openInApp) openInApp(out.digestId);
    return out;
  }
  const forceMode = values.mode as 'morning' | 'nightly' | 'weekly' | 'monthly' | undefined;
  const common = { trigger: 'cli' as const, dryRun: values['dry-run'], lookbackWindow: values.lookback, forceMode };
  return values.prompt ? { kind: 'prompt' as const, ...(await runPrompt(common)) } : run(common);
}

try {
  const out = await main();
  if (!out) {
    // nothing ran
  } else if (out.kind === 'skipped') {
    console.log(`skipped: ${(out as { reason: string }).reason}`);
  } else {
    const o = out as Record<string, any>;
    console.log(`\n✓ ${o.kind} run ${o.runId} (${o.mode}${o.llmTier ? `, answered by ${o.llmTier}` : ''})`);
    if (o.delivery) for (const d of o.delivery) console.log(`  ${d.target.padEnd(8)} ${d.status.padEnd(8)} ${d.detail}`);
    if (o.stats?.coverage) console.log(`  coverage: ${JSON.stringify(o.stats.coverage)}`);
    console.log(`  digest saved (id ${o.digestId}) — ${(o.digest as string).length} chars`);
  }
  process.exitCode = 0;
} catch (err) {
  log.error({ job: values.job, err: (err as Error).message }, 'run failed');
  console.error(`\n✕ run failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  db().close();
}
