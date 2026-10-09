import type { Config } from '../../config/schema.js';
import type { RunContext } from '../types.js';

export interface DeliveryInput {
  digest: string;   // final, tag-stripped Markdown
  mode: string;
  lookbackWindow: string;
}

/** What a target would send — rendered for real runs AND dry runs. */
export interface Rendered {
  /** Short human summary for the run log, e.g. "7 messages" */
  summary: string;
  /** Files to write in dry-run preview mode: name → content */
  preview: Record<string, string>;
  send: () => Promise<string>;
}

/**
 * A delivery target. To add one: implement this, then add it to TARGETS in registry.ts
 * (and a config toggle in config/schema.ts → delivery). See README → "Adding a delivery target".
 */
export interface DeliveryTarget {
  name: string;
  /** Config toggle for this target. */
  enabled(config: Config): boolean;
  /** Reason it can't run even though it's enabled (e.g. missing secret), or null. */
  misconfigured(config: Config): string | null;
  render(input: DeliveryInput, ctx: RunContext): Rendered;
}
