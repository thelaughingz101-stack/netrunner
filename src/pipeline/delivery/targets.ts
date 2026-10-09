import fs from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import nodemailer from 'nodemailer';
import { env } from '../../env.js';
import { outputDir } from '../../config/store.js';
import { discordChunks, fileContent, mdToHtml } from '../format/index.js';
import type { DeliveryTarget } from './types.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Discord: IF Discord Enabled → Discord Chunks → Filter → Wait 1s → Send to Discord ──
export const discord = (fetchImpl: typeof fetch = fetch): DeliveryTarget => ({
  name: 'discord',
  enabled: c => c.delivery.discord === true,
  misconfigured: () => (env().DISCORD_WEBHOOK_URL ? null : 'DISCORD_WEBHOOK_URL not set in .env'),
  render(input, ctx) {
    const chunks = discordChunks(input.digest, input.mode, input.lookbackWindow, ctx.now, ctx.config.schedule.timezone);
    return {
      summary: `${chunks.length} messages`,
      preview: { 'discord.json': JSON.stringify(chunks.map(content => ({ content })), null, 2) },
      async send() {
        const url = env().DISCORD_WEBHOOK_URL!;
        for (const [i, content] of chunks.entries()) {
          if (i > 0) await sleep(1000); // n8n "Wait" node (amount: 1s) between messages
          for (let attempt = 1; ; attempt++) {
            const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }), signal: AbortSignal.timeout(20_000) });
            if (res.ok) break;
            if (res.status === 429 && attempt < 5) {
              const body: any = await res.json().catch(() => ({}));
              await sleep(Math.ceil((body.retry_after ?? 2) * 1000));
              continue;
            }
            throw new Error(`Discord HTTP ${res.status} on message ${i + 1}/${chunks.length}: ${(await res.text()).slice(0, 200)}`);
          }
        }
        return `${chunks.length} messages posted`;
      },
    };
  },
});

// ── Email: IF Email Enabled → MD to HTML → Send an Email (SMTP from .env) ──
export const email = (transportFactory = (opts: object) => nodemailer.createTransport(opts)): DeliveryTarget => ({
  name: 'email',
  enabled: c => c.delivery.email === true,
  misconfigured(c) {
    const e = env();
    if (!(e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASS)) return 'SMTP_HOST / SMTP_USER / SMTP_PASS not set in .env';
    if (!(c.delivery.emailAddress || e.EMAIL_TO)) return 'no recipient (Config UI email address or EMAIL_TO)';
    return null;
  },
  render(input, ctx) {
    const { html, subjectLabel } = mdToHtml(input.digest, input.mode, input.lookbackWindow, ctx.today);
    const e = env();
    const to = ctx.config.delivery.emailAddress || e.EMAIL_TO!;
    const subject = `${subjectLabel} — ${ctx.today}`;
    return {
      summary: `to ${to}: "${subject}"`,
      preview: { 'email.html': html, 'email-subject.txt': subject },
      async send() {
        const t = transportFactory({ host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE, auth: { user: e.SMTP_USER, pass: e.SMTP_PASS } });
        const info: any = await (t as any).sendMail({ from: e.EMAIL_FROM || e.SMTP_USER, to, subject, html });
        return `sent to ${to}${info?.messageId ? ` (${info.messageId})` : ''}`;
      },
    };
  },
});

// ── File: IF Save File Enabled → write. Honors outputPath + fileFormat (n8n ignored both). ──
export const file = (): DeliveryTarget => ({
  name: 'file',
  enabled: c => c.delivery.textFile === true,
  misconfigured: () => null,
  render(input, ctx) {
    const stamp = DateTime.fromJSDate(ctx.now).setZone(ctx.config.schedule.timezone).toFormat('yyyy-MM-dd-HH-mm');
    const name = `digest-${stamp}-${input.mode}.${ctx.config.delivery.fileFormat}`;
    const content = fileContent(input.digest, input.mode, input.lookbackWindow, ctx.today);
    const dir = outputDir(ctx.config);
    return {
      summary: path.join(dir, name),
      preview: { [name]: content },
      async send() {
        fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, name);
        fs.writeFileSync(dest, content, 'utf8');
        return dest;
      },
    };
  },
});
