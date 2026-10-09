import { db } from '../../db/db.js';
import { generate, type EngineOptions } from '../llm/engine.js';
import type { LLMResult } from '../llm/types.js';
import type { DigestPrompt } from '../prompt/index.js';
import type { Item, RunContext } from '../types.js';
import { diffCoverage, forcePlace, ID_RULE, mergeRecovery, recoveryPrompt, removeUntaggedMentions } from './coverage.js';

export const MAX_RECOVERY_ROUNDS = 2;

export interface CoverageOutcome {
  digest: string;              // still tagged — strip before delivery
  placements: Map<string, 'section' | 'excluded' | 'recovered' | 'forced'>;
  rounds: { round: number; missingBefore: number; tier?: string; recovered: number; error?: string }[];
  forced: number;
  extraTiers: string[];
}

/**
 * Diff the first answer against the id set; re-run the LLM for ONLY the missing items
 * (up to MAX_RECOVERY_ROUNDS), merge each recovery into the right sections, and finally place
 * anything still missing deterministically. Never relies on the prompt wording alone.
 */
export async function ensureCoverage(
  ctx: RunContext, items: Item[], prompt: DigestPrompt, first: LLMResult, engineOpts: EngineOptions = {},
): Promise<CoverageOutcome> {
  const ids = items.map(i => i.id!);
  const byId = new Map(items.map(i => [i.id!, i]));
  let digest = first.text;
  const initial = diffCoverage(digest, ids);
  const placements: CoverageOutcome['placements'] = new Map(initial.found);
  const rounds: CoverageOutcome['rounds'] = [];
  const extraTiers: string[] = [];
  let missing = initial.missing;

  ctx.log.info({ expected: ids.length, inSections: [...initial.found.values()].filter(v => v === 'section').length,
    excluded: [...initial.found.values()].filter(v => v === 'excluded').length, missing: missing.length, unknownIds: initial.unknown.length },
  'coverage check');

  for (let round = 1; round <= MAX_RECOVERY_ROUNDS && missing.length > 0; round++) {
    const before = missing.length;
    try {
      const res = await generate({ kind: 'recovery', prompt: recoveryPrompt(prompt, missing.map(id => byId.get(id)!)), idRule: ID_RULE }, ctx.config, ctx.log, engineOpts);
      extraTiers.push(res.tier);
      const got = diffCoverage(res.text, missing);
      const recoveredIds = [...got.found.keys()];
      if (recoveredIds.length) {
        const cleaned = removeUntaggedMentions(digest, recoveredIds.map(id => byId.get(id)!));
        if (cleaned.removed) ctx.log.info({ round, removed: cleaned.removed }, 'removed untagged duplicate mentions of recovered items');
        digest = mergeRecovery(cleaned.digest, res.text);
      }
      for (const id of recoveredIds) placements.set(id, got.found.get(id) === 'excluded' ? 'excluded' : 'recovered');
      missing = got.missing;
      rounds.push({ round, missingBefore: before, tier: res.tier, recovered: recoveredIds.length });
      ctx.log.info({ round, recovered: recoveredIds.length, stillMissing: missing.length, tier: res.tier }, 'coverage recovery round');
    } catch (err) {
      rounds.push({ round, missingBefore: before, recovered: 0, error: (err as Error).message });
      ctx.log.warn({ round, err: (err as Error).message }, 'coverage recovery failed');
      break;
    }
  }

  if (missing.length) {
    digest = forcePlace(removeUntaggedMentions(digest, missing.map(id => byId.get(id)!)).digest, missing.map(id => byId.get(id)!));
    for (const id of missing) placements.set(id, 'forced');
    ctx.log.warn({ forced: missing.length }, 'items still missing after recovery — placed under Everything Else without a summary');
  }

  ctx.stats.coverage = {
    expected: ids.length,
    firstPassMissing: initial.missing.length,
    unknownIdsInOutput: initial.unknown.length,
    rounds,
    forced: missing.length,
    finalAccounted: placements.size,
  };
  recordItems(ctx, items, placements);
  return { digest, placements, rounds, forced: missing.length, extraTiers };
}

function recordItems(ctx: RunContext, items: Item[], placements: CoverageOutcome['placements']) {
  const ins = db().prepare('INSERT OR REPLACE INTO run_items (run_id, item_id, source, category, title, link, published, placement) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  db().transaction(() => {
    for (const i of items) ins.run(ctx.runId, i.id, i.source, i.category, i.title, i.link, i.published, placements.get(i.id!) ?? 'missing');
  })();
}
