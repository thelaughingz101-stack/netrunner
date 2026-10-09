import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { freshState } from './helpers.js';
import { normalizeConfig } from '../src/config/schema.js';
import { createRun } from '../src/pipeline/runs.js';
import { deliverAll } from '../src/pipeline/delivery/registry.js';
import { discord, email, file } from '../src/pipeline/delivery/targets.js';
import { catchUpText, discordChunks, digestLabel, fileContent, mdToHtml } from '../src/pipeline/format/index.js';
import { db } from '../src/db/db.js';

const longDigest = Array.from({ length: 12 }, (_, s) =>
  `## Section ${s}\n` + Array.from({ length: 6 }, (_, i) => `- [**Headline ${s}.${i}**](https://ex.com/${s}/${i}) — ${'word '.repeat(30)}*(Src)*`).join('\n')).join('\n\n');

describe('formatting ports', () => {
  it('Discord Chunks: header first, every chunk ≤ 1900 + footer, links wrapped to suppress embeds', () => {
    const chunks = discordChunks(longDigest, 'morning', '12h', new Date('2026-10-08T12:00:00Z'), 'America/New_York');
    expect(chunks[0]).toMatch(/^🌅 \*\*MORNING DIGEST — Thursday, October 8, 2026\*\*\n\*Covers the last 12 hours\*\n─{40}\n\n\*1\/\d+\*$/);
    expect(chunks.length).toBeGreaterThan(3);
    for (const [i, c] of chunks.slice(1).entries()) {
      expect(c.replace(/\n\n\*\d+\/\d+\*$/, '').length).toBeLessThanOrEqual(1900);
      expect(c.endsWith(`*${i + 2}/${chunks.length}*`)).toBe(true);
    }
    expect(chunks.join('')).toContain('](<https://ex.com/0/0>)');
    expect(chunks.join('')).not.toMatch(/\]\(https:/);
  });

  it('lookback-aware labels (and rollups no longer mislabeled "Nightly")', () => {
    expect(digestLabel('nightly', '12h').label).toBe('Nightly Digest');
    expect(digestLabel('morning', '1w')).toEqual({ emoji: '📅', label: 'Weekly Digest' });
    expect(digestLabel('weekly', '12h').label).toBe('Weekly Rollup');
    expect(fileContent('# x', 'morning', '24h', '2026-10-08')).toBe(`📰 Daily Digest — 2026-10-08\nCovers the last 24 hours\n${'='.repeat(40)}\n\n# x`);
  });

  it('MD to HTML: same conversions and subject label as the n8n node', () => {
    const { html, subjectLabel } = mdToHtml('## Gaming\n- [**GTA**](https://x) — big. *(IGN)*', 'morning', '12h', '2026-10-08');
    expect(subjectLabel).toBe('🌅 Morning Digest');
    expect(html).toContain('<h2>Gaming</h2>');
    expect(html).toContain('<li><a href="https://x"><strong>GTA</strong></a> — big. <em>(IGN)</em></li>');
  });
});

describe('delivery gates', () => {
  let outDir: string;
  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-out-'));
    freshState({ DISCORD_WEBHOOK_URL: 'https://discord.test/hook', SMTP_HOST: 'smtp.test', SMTP_USER: 'u', SMTP_PASS: 'p', DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'nr-data-')) });
  });
  const run = (delivery: object, dryRun = false) =>
    createRun({ config: normalizeConfig({ delivery: { outputPath: outDir, ...delivery } }), mode: 'morning', lookbackWindow: '12h', dryRun, trigger: 'cli', kind: 'digest' });

  function fakes() {
    const posts: string[] = [];
    const mails: any[] = [];
    let first429 = true;
    const fetchImpl = (async (_url: string, init: any) => {
      if (first429) { first429 = false; return new Response(JSON.stringify({ retry_after: 0.01 }), { status: 429 }); }
      posts.push(JSON.parse(init.body).content);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const transport = () => ({ sendMail: async (m: any) => { mails.push(m); return { messageId: 'id1' }; } });
    return { posts, mails, targets: [discord(fetchImpl), email(transport as any), file()] };
  }

  it('each gate fires only when its toggle is on', async () => {
    const f = fakes();
    const ctx = run({ discord: false, email: true, emailAddress: 'me@x.dev', textFile: false });
    const res = await deliverAll({ digest: '## Gaming\n- a', mode: 'morning', lookbackWindow: '12h' }, ctx, f.targets);
    expect(res.map(r => [r.target, r.status])).toEqual([['discord', 'skipped'], ['email', 'sent'], ['file', 'skipped']]);
    expect(f.posts).toHaveLength(0);
    expect(f.mails[0]).toMatchObject({ to: 'me@x.dev', subject: '🌅 Morning Digest — ' + ctx.today + ' (last 12 hours)' });
  });

  it('sends Discord chunks in order (retrying a 429) and writes the file with the chosen format', async () => {
    const f = fakes();
    const ctx = run({ discord: true, textFile: true, fileFormat: 'txt' });
    const res = await deliverAll({ digest: '## Gaming\n- a', mode: 'morning', lookbackWindow: '12h' }, ctx, f.targets);
    expect(res.find(r => r.target === 'discord')?.status).toBe('sent');
    expect(f.posts).toHaveLength(2);
    expect(f.posts[0]).toMatch(/^🌅 \*\*MORNING DIGEST/);
    const written = res.find(r => r.target === 'file')!.detail;
    expect(written.startsWith(outDir)).toBe(true);
    expect(written.endsWith('-morning.txt')).toBe(true);
    expect(fs.readFileSync(written, 'utf8')).toContain('🌅 Morning Digest — ');
    expect(db().prepare('SELECT COUNT(*) n FROM deliveries WHERE run_id = ?').get(ctx.runId)).toEqual({ n: 3 });
  });

  it('one failing target does not block the others', async () => {
    const f = fakes();
    freshState({ DISCORD_WEBHOOK_URL: undefined, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'nr-data-')) });
    const ctx = run({ discord: true, textFile: true });
    const res = await deliverAll({ digest: 'x', mode: 'morning', lookbackWindow: '12h' }, ctx, f.targets);
    expect(res.find(r => r.target === 'discord')).toMatchObject({ status: 'error', detail: expect.stringMatching(/DISCORD_WEBHOOK_URL/) });
    expect(res.find(r => r.target === 'file')?.status).toBe('sent');
  });

  it('dry run sends NOTHING and writes previews instead', async () => {
    const f = fakes();
    const ctx = run({ discord: true, email: true, emailAddress: 'me@x.dev', textFile: true }, true);
    const res = await deliverAll({ digest: '## Gaming\n- a', mode: 'morning', lookbackWindow: '12h' }, ctx, f.targets);
    expect(res.every(r => r.status === 'dry-run')).toBe(true);
    expect(f.posts).toHaveLength(0);
    expect(f.mails).toHaveLength(0);
    expect(fs.readdirSync(outDir)).toHaveLength(0);
    const preview = res[0].detail.split('preview in ')[1];
    expect(fs.readdirSync(preview).sort()).toEqual(expect.arrayContaining(['discord-discord.json', 'email-email.html']));
  });
});

describe('Catch-up range in the digest title', () => {
  it('says how far back the run looked, except for recaps', () => {
    expect(catchUpText('morning', '12h')).toBe('Covers the last 12 hours');
    expect(catchUpText('nightly', '1mo')).toBe('Covers the last month');
    expect(catchUpText('weekly', '1w')).toBe('');
    expect(catchUpText('monthly', '24h')).toBe('');
  });
  it('appears in the file header, the Discord header and the email', () => {
    expect(fileContent('## A', 'morning', '24h', '2026-10-09').split('\n').slice(0, 2)).toEqual(['📰 Daily Digest — 2026-10-09', 'Covers the last 24 hours']);
    expect(discordChunks('## A\n- x', 'morning', '3d', new Date('2026-10-09T12:00:00Z'), 'America/New_York')[0]).toContain('*Covers the last 3 days*');
    expect(mdToHtml('## A', 'nightly', '12h', '2026-10-09').html).toContain('Covers the last 12 hours');
  });
});
