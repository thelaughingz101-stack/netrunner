// Ports of n8n "Prep-File", "Discord Chunks", "MD to HTML" — formatting logic unchanged.
// Only change: dates use the configured timezone instead of the server's/n8n's local clock.
import { DateTime } from 'luxon';

type Label = { emoji: string; label: string };
const LOOKBACK_LABELS: Record<string, Label> = {
  '24h': { emoji: '📰', label: 'Daily Digest' },
  '3d':  { emoji: '📰', label: 'Daily Digest' },
  '1w':  { emoji: '📅', label: 'Weekly Digest' },
  '2w':  { emoji: '📅', label: 'Weekly Digest' },
  '1mo': { emoji: '🗓️', label: 'Monthly Digest' },
};

/** Lookback-aware title shared by the file, email, and Discord header (cosmetic only). */
export function digestLabel(mode: string, lookbackWindow: string): Label {
  if (mode === 'weekly') return { emoji: '📅', label: 'Weekly Rollup' };
  if (mode === 'monthly') return { emoji: '🗓️', label: 'Monthly Recap' };
  if (LOOKBACK_LABELS[lookbackWindow]) return LOOKBACK_LABELS[lookbackWindow];
  // 12h (default/scheduled runs) — normal morning/nightly labeling
  return mode === 'morning' ? { emoji: '🌅', label: 'Morning Digest' } : { emoji: '🌙', label: 'Nightly Digest' };
}

const CATCH_UP: Record<string, string> = {
  '12h': 'last 12 hours', '24h': 'last 24 hours', '3d': 'last 3 days',
  '1w': 'last week', '2w': 'last 2 weeks', '1mo': 'last month',
};

/** "Covers the last 24 hours": the Catch-up range the run used, so readers know how far back it looked.
 *  Empty for recaps, which summarise saved digests instead of scanning feeds. */
export function catchUpText(mode: string, lookbackWindow: string): string {
  if (mode === 'weekly' || mode === 'monthly') return '';
  const range = CATCH_UP[lookbackWindow];
  return range ? `Covers the ${range}` : '';
}

/** Prep-File: header + digest. */
export function fileContent(digest: string, mode: string, lookbackWindow: string, date: string): string {
  const { emoji, label } = digestLabel(mode, lookbackWindow);
  const covers = catchUpText(mode, lookbackWindow);
  return `${emoji} ${label} — ${date}${covers ? `\n${covers}` : ''}\n${'='.repeat(40)}\n\n${digest}`;
}

/** Discord Chunks: embed suppression, ≤1900-char chunks split on sections → paragraphs → lines, i/N footers. */
export function discordChunks(digestIn: string, mode: string, lookbackWindow: string, now: Date, timezone: string): string[] {
  // Suppress Discord auto-embeds on every markdown link
  const digest = digestIn.replace(/\]\((https?:\/\/[^\s)]+)\)/g, '](<$1>)');
  const { emoji, label } = digestLabel(mode, lookbackWindow);
  const date = DateTime.fromJSDate(now).setZone(timezone).toLocaleString({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }, { locale: 'en-US' });
  const covers = catchUpText(mode, lookbackWindow);
  const header = `${emoji} **${label.toUpperCase()} — ${date}**${covers ? `\n*${covers}*` : ''}\n${'─'.repeat(40)}`;

  const LIMIT = 1900;
  // Stage 1: split on section boundaries then paragraphs
  const sections = digest.split(/(?=\n## )/);
  const chunks: string[] = [];
  let buf = '';
  for (const section of sections) {
    if ((buf + section).length > LIMIT && buf.length > 0) {
      chunks.push(buf.trim());
      buf = section;
    } else {
      buf += section;
    }
    if (buf.length > LIMIT) {
      const paragraphs = buf.split(/\n\n+/);
      buf = '';
      for (const para of paragraphs) {
        if ((buf ? buf + '\n\n' : '').length + para.length > LIMIT) {
          chunks.push(buf.trim());
          buf = para;
        } else {
          buf += (buf ? '\n\n' : '') + para;
        }
      }
    }
  }
  if (buf.trim()) chunks.push(buf.trim());

  // Stage 2: hard failsafe — force-split anything still over LIMIT at last newline
  const safe: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= LIMIT) {
      safe.push(chunk);
    } else {
      let remaining = chunk;
      while (remaining.length > LIMIT) {
        const cut = remaining.lastIndexOf('\n', LIMIT);
        const splitAt = cut > 0 ? cut : LIMIT;
        safe.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
      }
      if (remaining) safe.push(remaining);
    }
  }

  const total = safe.length + 1;
  const indexed = safe.map((c, i) => `${c}\n\n*${i + 2}/${total}*`);
  // n8n's "Filter" node dropped empty chunks before sending
  return [`${header}\n\n*1/${total}*`, ...indexed].filter(c => c.trim() !== '');
}

/** MD to HTML: returns the email HTML and subject label. */
export function mdToHtml(digest: string, mode: string, lookbackWindow: string, date: string): { html: string; subjectLabel: string } {
  const { emoji, label } = digestLabel(mode, lookbackWindow);
  const subjectLabel = `${emoji} ${label}`;
  const covers = catchUpText(mode, lookbackWindow);
  const toHtml = (md: string) => md
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\[\*\*(.+?)\*\*\]\((.+?)\)/g, '<a href="$2"><strong>$1</strong></a>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*\((.+?)\)\*/g, '<em>($1)</em>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  const html = `
<html><body style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #222;">
<h1 style="font-size:22px; margin-bottom:4px;">${subjectLabel} — ${date}</h1>${covers ? `
<p style="margin:0; color:#777; font-size:13px;">${covers}</p>` : ''}
<hr style="border:none; border-top:1px solid #ccc; margin:12px 0 20px;">
<p>${toHtml(digest)}</p>
</body></html>`;
  return { html, subjectLabel };
}
