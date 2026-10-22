// Tidies the links in a written digest before it's saved and sent (Zion, 2026-10-22):
// - Gemini cites what it found by searching through Google redirect links
//   (vertexaisearch.cloud.google.com/grounding-api-redirect/…), not the article's own address. Each one is
//   followed once (Google answers with a redirect to the real page) and swapped in; a failure keeps it as is.
// - A story that links to its article but names no outlet gets one from the link's address (the same names the
//   Sources tab uses), so every linked story says where it's from.
import pLimit from 'p-limit';
import { tagSource } from './ingest/normalize.js';

const REDIRECT = /https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[A-Za-z0-9_=-]+/g;
const TIMEOUT_MS = 10_000;

/** Where a redirect link really goes; 'dead' when Google says it leads nowhere (404/410); null when unsure. */
export type FollowRedirect = (url: string) => Promise<string | 'dead' | null>;

export const followRedirect: FollowRedirect = async url => {
  const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NetRunner/1.0; +self-hosted news digest)' } });
  if (res.status === 404 || res.status === 410) return 'dead';
  const to = res.headers.get('location');
  return res.status >= 300 && res.status < 400 && to && /^https?:\/\//i.test(to) ? to : null;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Swaps each search redirect for the page it leads to. One that leads nowhere (Gemini sometimes cites a
 * redirect Google doesn't know) loses its link and keeps its text; one that can't be checked stays as is.
 */
export async function resolveSearchRedirects(md: string, opts: { follow?: FollowRedirect; concurrency?: number } = {}): Promise<{ md: string; resolved: number; unlinked: number; failed: number }> {
  const urls = [...new Set(md.match(REDIRECT) ?? [])];
  if (!urls.length) return { md, resolved: 0, unlinked: 0, failed: 0 };
  const follow = opts.follow ?? followRedirect;
  const limit = pLimit(opts.concurrency ?? 4);
  const real = new Map<string, string>();
  const dead: string[] = [];
  await Promise.all(urls.map(u => limit(async () => {
    try {
      const to = await follow(u);
      if (to === 'dead') dead.push(u); else if (to) real.set(u, to);
    } catch { /* keep the redirect */ }
  })));
  let out = md;
  for (const u of dead) out = out.replace(new RegExp(`\\[([^\\]]*)\\]\\(${escapeRe(u)}\\)`, 'g'), '$1');
  out = out.replace(REDIRECT, u => real.get(u) ?? u);
  return { md: out, resolved: real.size, unlinked: dead.length, failed: urls.length - real.size - dead.length };
}

/** "Outlet" for a link: its Sources name when NetRunner knows the site, else the bare host ("apnews.com"). */
export function outletFor(link: string): string | null {
  const { src } = tagSource({ link });
  if (src.category !== 'Custom Feeds' && src.name !== 'Google News') return src.name;
  const host = link.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.replace(/^www\./, '');
  return host && !/google\.com$/.test(host) ? host : null;
}

/** Adds *(Outlet)* to linked story bullets that name none (not in EXCLUDED, whose lines have their own format). */
export function addMissingOutlets(md: string): { md: string; added: number } {
  let added = 0;
  let excluded = false;
  const out = md.split('\n').map(line => {
    if (/^##\s/.test(line)) excluded = /EXCLUDED/i.test(line);
    if (excluded || !/^\s*[-*]\s/.test(line) || /\*\([^)]*\)\*/.test(line)) return line;
    const link = line.match(/\]\((https?:\/\/[^)\s]+)\)/)?.[1];
    const outlet = link && outletFor(link);
    if (!outlet) return line;
    added++;
    return `${line.trimEnd()} *(${outlet})*`;
  });
  return { md: out.join('\n'), added };
}
