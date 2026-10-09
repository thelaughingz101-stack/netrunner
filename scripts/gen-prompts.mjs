// One-off generator: wraps the DEPLOYED n8n prompt-builder Code nodes (../n8n-export/nodes)
// verbatim inside a tiny shim that stands in for n8n's `$('Node')` / `$input` accessors, so the
// prompt text the LLM sees is byte-identical to what n8n sent — except for the PATCHES below,
// each of which is a flagged, deliberate fix (also listed in CHANGES_FROM_N8N.md).
// The generator fails loudly if a patch target is missing, so a re-sync can't silently skip one.
import fs from 'node:fs';
import path from 'node:path';
import { exporterTopicPatches, PAYLOAD_TOPIC_PATCHES } from './topic-patches.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const nodes = path.resolve(here, '../../n8n-export/nodes');
const outDir = path.resolve(here, '../src/pipeline/prompt/generated');
fs.mkdirSync(outDir, { recursive: true });

const FILLER = 'FILLER REJECTION: Identify subjective gameplay anecdotes, opinion pieces, and promotional filler, and route them exclusively to the EXCLUDED ledger with reason: filler.';

// The Format tab's Summary length was only honored by the AI Writer prompt (Build LLM Payload); the five
// copy-paste exporters hardcoded "2–3 sentences". Same wording as Build LLM Payload's summaryLengthMap.
const SUMMARY_PATCHES = [
  {
    id: 'summary-length-def',
    why: 'Copy-paste exporters ignored format.summaryLength; read it from the config (same three options as Build LLM Payload).',
    from: "const TZ = 'America/New_York';",
    to: `const SUMMARY_RULE_TEXT = ({
  '1':    'Each item gets exactly 1 sentence — the headline plus the single most important fact. No elaboration.',
  '2-3':  'Each item gets a 2-3 sentence summary — enough context to understand why it matters. Never pad with filler.',
  'full': 'Each item gets a full 3-5 sentence summary with meaningful context, background, and why it matters. Do not pad artificially, but go deeper than a quick blurb.'
})[(() => { try { return $('Parse Config').first().json.config?.format?.summaryLength; } catch (e) { return undefined; } })()] || 'Each item gets a 2-3 sentence summary — enough context to understand why it matters. Never pad with filler.';

const TZ = 'America/New_York';`,
  },
  {
    id: 'summary-length-rule',
    why: 'Use the configured summary length instead of the hardcoded "2–3 sentences".',
    from: 'SUMMARIES: 2–3 sentences each, no filler.',
    to: 'SUMMARIES: ${SUMMARY_RULE_TEXT}',
  },
];
const summary = name => SUMMARY_PATCHES.map(p => ({ ...p, id: `${p.id}-${name}` }));

const TARGETS = [
  {
    file: 'Build LLM Payload.js', out: 'buildLlmPayload.ts', node: 'Build LLM Payload',
    patches: [
      ...PAYLOAD_TOPIC_PATCHES,
      {
        id: 'filler-splice-payload',
        why: 'update.py spliced FILLER REJECTION into the middle of the "NEVER invent" sentence (and left a double period). Restored the sentence and made FILLER its own bullet.',
        from: `- NEVER invent, extrapolate, or assume\\n- ${FILLER}. Unknown = excluded (with a reason), never invented.`,
        to: `- NEVER invent, extrapolate, or assume. Unknown = excluded (with a reason), never invented.\n- ${FILLER}`,
      },
      {
        id: 'filler-reason-payload',
        why: 'The ledger allowed only 4 reasons while FILLER REJECTION requires reason "filler" (the model already emitted it). Added filler as the 5th valid reason.',
        from: '"- Headline (Source) — reason: duplicate | stale | unverified | spam". If nothing was excluded, write "EXCLUDED: none". Rules for the ledger:\n- ONLY the four reasons above are valid. Not "review", not "opinion", not "not a comic", not "covered by RSS" — if none of duplicate/stale/unverified/spam fits,',
        to: '"- Headline (Source) — reason: duplicate | stale | unverified | spam | filler". If nothing was excluded, write "EXCLUDED: none". Rules for the ledger:\n- ONLY the five reasons above are valid. Not "review", not "opinion", not "not a comic", not "covered by RSS" — if none of duplicate/stale/unverified/spam/filler fits,',
      },
    ],
  },
  { file: 'digest_export__ChatGPT_.js', out: 'exportChatgpt.ts', node: 'digest_export_(ChatGPT)', patches: [...summary('chatgpt'), ...exporterTopicPatches('chatgpt')] },
  { file: 'digest_export__Claude_.js', out: 'exportClaude.ts', node: 'digest_export_(Claude)', patches: [...summary('claude'), ...exporterTopicPatches('claude')] },
  { file: 'digest_export__grok_.js', out: 'exportGrok.ts', node: 'digest_export_(grok)', patches: [...summary('grok'), ...exporterTopicPatches('grok')] },
  { file: 'Digest_export__DeepSeek_.js', out: 'exportDeepseek.ts', node: 'Digest_export_[DeepSeek]', patches: [...summary('deepseek'), ...exporterTopicPatches('deepseek')] },
  {
    file: 'digest_export__Gemini_.js', out: 'exportGemini.ts', node: 'digest_export_(Gemini)',
    patches: [
      {
        id: 'literal-template-gemini-bf',
        why: 'Escaped \\${…} sent the literal text "${mode === \'nightly\' ? …}" to the model instead of the resolved phrase.',
        from: "index levels (S&P 500, Nasdaq, Dow): \\${mode === 'nightly'",
        to: "index levels (S&P 500, Nasdaq, Dow): ${mode === 'nightly'",
      },
      {
        id: 'literal-template-gemini-uspol',
        why: 'Same escaped \\${…} bug in the US Politics rule.',
        from: "Reuters, AP, BBC, Politico. \\${mode === 'nightly'",
        to: "Reuters, AP, BBC, Politico. ${mode === 'nightly'",
      },
      {
        id: 'filler-splice-gemini',
        why: 'update.py spliced FILLER REJECTION into the middle of the "NEVER use training data" sentence. Restored the sentence and made FILLER its own bullet.',
        from: `- NEVER use training data, memory\\n- ${FILLER}, or assumption to fill gaps. Unknown = omitted.`,
        to: `- NEVER use training data, memory, or assumption to fill gaps. Unknown = omitted.\n- ${FILLER}`,
      },
      {
        id: 'filler-reason-gemini',
        why: 'Added filler as a valid EXCLUDED reason to match FILLER REJECTION.',
        from: '"- Headline (Source) — reason: duplicate | stale | unverified | spam". If nothing was excluded',
        to: '"- Headline (Source) — reason: duplicate | stale | unverified | spam | filler". If nothing was excluded',
      },
      ...summary('gemini'),
      ...exporterTopicPatches('gemini'),
    ],
  },
];

const applied = [];
for (const t of TARGETS) {
  let code = fs.readFileSync(path.join(nodes, t.file), 'utf8').replace(/\r\n/g, '\n');
  for (const p of t.patches) {
    // `between: [start, end]` replaces from start through end (inclusive); `count` = expected matches.
    const want = p.count ?? 1;
    const targets = [];
    if (p.between) {
      let at = 0;
      for (;;) {
        const i = code.indexOf(p.between[0], at);
        if (i < 0) break;
        const j = code.indexOf(p.between[1], i);
        if (j < 0) throw new Error(`patch ${p.id}: end marker not found after start in ${t.file}`);
        targets.push(code.slice(i, j + p.between[1].length));
        at = j;
      }
    } else {
      for (let i = 0; i < code.split(p.from).length - 1; i++) targets.push(p.from);
    }
    if (targets.length !== want) throw new Error(`patch ${p.id}: expected ${want} match(es) in ${t.file}, found ${targets.length}`);
    // split/join, not String.replace: patch text contains $ sequences that replace() would interpret.
    for (const target of new Set(targets)) code = code.split(target).join(p.to);
    applied.push({ id: p.id, node: t.node, why: p.why });
  }
  fs.writeFileSync(path.join(outDir, t.out),
`// @ts-nocheck
// GENERATED by scripts/gen-prompts.mjs — do not hand-edit.
// Verbatim body of the deployed n8n Code node "${t.node}", run under a shim for $ / $input.
// Patches applied: ${t.patches.length ? t.patches.map(p => p.id).join(', ') : 'none'} (see CHANGES_FROM_N8N.md).

export function run(input: unknown, nodes: Record<string, unknown>): any {
  const $input = { first: () => ({ json: input }), all: () => [{ json: input }] };
  const $ = (name: string) => {
    if (!(name in nodes)) throw new Error(\`n8n node not available in shim: \${name}\`);
    return { first: () => ({ json: nodes[name] }) };
  };
  // ───────────── begin verbatim n8n code ─────────────
${code}
  // ───────────── end verbatim n8n code ─────────────
}
`);
}
fs.writeFileSync(path.join(outDir, 'patches.json'), JSON.stringify(applied, null, 2));
console.log(`generated ${TARGETS.length} prompt builders, ${applied.length} patches applied`);
