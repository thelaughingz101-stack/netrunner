// A saved digest, read back into sections and bullets for the grader.
import { EVERYTHING_ELSE_HEADER, EXCLUDED_HEADER, headerKey } from '../coverage/coverage.js';
import { SECTION_HEADERS } from '../split.js';

export type SectionKind = 'topic' | 'updates' | 'else' | 'excluded' | 'unknown';

export interface Bullet {
  /** 1-based, across the whole digest (EXCLUDED lines aren't numbered: they're the AI's list of what it left out). */
  n: number;
  section: string;
  topic: string | null;
  kind: SectionKind;
  line: string;
  headline: string;
  link: string | null;
  /** The outlets in the closing *(…)*, in order. */
  sources: string[];
  /** The bullet as plain text. */
  text: string;
}

export interface DigestSection { header: string; title: string; topic: string | null; kind: SectionKind; bullets: Bullet[]; excluded: string[] }
export interface ParsedDigest { pre: string; sections: DigestSection[]; bullets: Bullet[] }

const UPDATES = headerKey('## 🔄 Story Updates');
const TOPIC_BY_KEY = new Map(Object.entries(SECTION_HEADERS).map(([topic, header]) => [headerKey(header), topic]));

export const plainText = (line: string) => line
  .replace(/^\s*[-*]\s+/, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_`]+/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function bulletParts(line: string): Pick<Bullet, 'headline' | 'link' | 'sources'> {
  const bold = line.match(/\[\*\*(.+?)\*\*\]\(([^)\s]+)\)/);
  const plainLink = bold ? null : line.match(/\[([^\]]+)\]\(([^)\s]+)\)/);
  const boldOnly = bold || plainLink ? null : line.match(/\*\*(.+?)\*\*/);
  const headline = (bold?.[1] ?? plainLink?.[1] ?? boldOnly?.[1] ?? plainText(line).split(' — ')[0]).trim();
  const link = bold?.[2] ?? plainLink?.[2] ?? null;
  const tail = [...line.matchAll(/\*\(([^)]*)\)\*/g)].at(-1)?.[1];
  const sources = tail ? tail.split(/,\s*/).map(s => s.trim()).filter(Boolean) : [];
  return { headline, link, sources };
}

export function parseDigest(md: string): ParsedDigest {
  const pre: string[] = [];
  const sections: DigestSection[] = [];
  const bullets: Bullet[] = [];
  for (const line of (md || '').split('\n')) {
    if (/^##\s/.test(line)) {
      const key = headerKey(line);
      const topic = TOPIC_BY_KEY.get(key) ?? null;
      const kind: SectionKind = topic ? 'topic' : key === UPDATES ? 'updates' : key === headerKey(EVERYTHING_ELSE_HEADER) ? 'else'
        : key === headerKey(EXCLUDED_HEADER) ? 'excluded' : 'unknown';
      sections.push({ header: line.trim(), title: line.replace(/^##\s*/, '').trim(), topic, kind, bullets: [], excluded: [] });
      continue;
    }
    const sec = sections.at(-1);
    if (!sec) { pre.push(line); continue; }
    if (!/^\s*[-*]\s+\S/.test(line)) continue;
    if (sec.kind === 'excluded') { sec.excluded.push(line); continue; }
    const b: Bullet = { n: bullets.length + 1, section: sec.title, topic: sec.topic, kind: sec.kind, line, ...bulletParts(line), text: plainText(line) };
    sec.bullets.push(b);
    bullets.push(b);
  }
  return { pre: pre.join('\n').trim(), sections, bullets };
}
