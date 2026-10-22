// The digest grader (Zion, 2026-10-22): reads the finished digest and checks it against the rules it was
// written under. It never edits anything. Code checks first (checks.ts: exact, free, repeatable), then one
// AI judge per criterion for what code can't decide (judge.ts). Each check gives partial credit (0–1); the
// grade is their weighted average out of 100, and the verdict is:
//   fail      a critical check failed (a switched-off topic showed up, looping or cut-off text, leftover tags)
//   attention something else failed, or the score is under 85
//   pass      everything passed
import type { Config } from '../../config/schema.js';
import { db } from '../../db/db.js';
import type { Logger } from '../../logger.js';
import type { EngineOptions } from '../llm/engine.js';
import type { Tier } from '../llm/types.js';
import { runCodeChecks, type CheckResult } from './checks.js';
import { runJudges } from './judge.js';
import { parseDigest } from './parse.js';

export type { CheckResult };
export type GradeVerdict = 'pass' | 'attention' | 'fail';

export interface GradeReport {
  score: number;
  verdict: GradeVerdict;
  checks: CheckResult[];
  /** Bullets graded. */
  bullets: number;
  /** The AI that judged ("gemini:gemini-2.5-flash"), or null when no AI check ran. */
  graderModel: string | null;
  /** Things to know when reading the grade ("checked against your current settings"). */
  notes: string[];
  gradedAt: string;
}

export interface GradeInput {
  content: string;
  config?: Config;
  runStats?: Record<string, any> | null;
  /** The AI that wrote the digest: the AI checks prefer a different one. */
  writerTier?: Tier;
  notes?: string[];
}

const PASS_SCORE = 85;

export function scoreChecks(checks: CheckResult[]): { score: number; verdict: GradeVerdict } {
  const counted = checks.filter(c => !c.skipped);
  const weight = counted.reduce((n, c) => n + c.weight, 0);
  const score = weight ? Math.round((counted.reduce((n, c) => n + c.score * c.weight, 0) / weight) * 100) : 100;
  const verdict: GradeVerdict = counted.some(c => c.critical && !c.pass) ? 'fail'
    : counted.some(c => !c.pass) || score < PASS_SCORE ? 'attention' : 'pass';
  return { score, verdict };
}

export async function gradeDigest(input: GradeInput, opts: { log: Logger; engine?: EngineOptions; ai?: boolean }): Promise<GradeReport> {
  const parsed = parseDigest(input.content);
  const code = runCodeChecks({ digest: input.content, parsed, config: input.config, runStats: input.runStats });
  const ai = opts.ai === false || !input.config
    ? { checks: [] as CheckResult[], model: null }
    : await runJudges(parsed, input.config, opts.log, opts.engine, input.writerTier);
  const checks = [...code, ...ai.checks];
  return {
    ...scoreChecks(checks),
    checks,
    bullets: parsed.bullets.length,
    graderModel: ai.model,
    notes: input.notes ?? [],
    gradedAt: new Date().toISOString(),
  };
}

export function saveGrade(digestId: number, runId: string | null, report: GradeReport): void {
  db().prepare('INSERT OR REPLACE INTO digest_grades (digest_id, run_id, score, verdict, json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(digestId, runId, report.score, report.verdict, JSON.stringify(report), report.gradedAt);
}

export function getGrade(digestId: number): GradeReport | null {
  const r = db().prepare('SELECT json FROM digest_grades WHERE digest_id = ?').get(digestId) as { json: string } | undefined;
  return r ? JSON.parse(r.json) : null;
}

/** Morning and nightly digests are what the grader knows how to read (recaps and copy-paste prompts are laid out differently). */
export const gradable = (mode: string) => mode === 'morning' || mode === 'nightly';
