import { describe, expect, it } from 'vitest';
import { capPerSource, limitPerTopic, perSourceCap, perTopicLimit } from '../src/pipeline/ingest/limits.js';
import type { Item } from '../src/pipeline/types.js';

const item = (p: Partial<Item>): Item => ({ mode: 'morning', source: 'IGN', category: 'Gaming', title: 't', link: 'l', published: '2026-10-16T10:00:00Z', summary: '', ...p });
const RANGES = ['12h', '24h', '3d', '1w', '2w', '1mo'];

describe('range-aware limits', () => {
  it('grow with the catch-up range, slowing down', () => {
    expect(RANGES.map(perSourceCap)).toEqual([8, 12, 20, 30, 40, 50]);
    expect(RANGES.map(perTopicLimit)).toEqual([25, 30, 40, 55, 65, 80]);
    expect(perSourceCap('nonsense')).toBe(8);
    expect(perTopicLimit('nonsense')).toBe(25);
  });

  it('per source: keeps the first N of each built-in source, never limits Custom Feeds', () => {
    const ign = Array.from({ length: 5 }, (_, i) => item({ title: `ign ${i}` }));
    const custom = Array.from({ length: 5 }, (_, i) => item({ source: 'my-blog.dev', category: 'Custom Feeds', title: `mine ${i}` }));
    const out = capPerSource([...ign, ...custom], 3);
    expect(out.items.map(i => i.title)).toEqual(['ign 0', 'ign 1', 'ign 2', 'mine 0', 'mine 1', 'mine 2', 'mine 3', 'mine 4']);
    expect(out.capped).toBe(2);
  });

  it('per topic: most outlets first, then newest; keeps the original order; Custom Feeds exempt', () => {
    const items = [
      item({ title: 'old single', published: '2026-10-16T01:00:00Z' }),
      item({ title: 'new single', published: '2026-10-16T09:00:00Z' }),
      item({ title: 'old big story', published: '2026-10-16T02:00:00Z', clusterSize: 3 }),
      item({ title: 'tech', category: 'Tech & Hardware' }),
      item({ title: 'mine', category: 'Custom Feeds' }),
      item({ title: 'mine 2', category: 'Custom Feeds' }),
    ];
    const out = limitPerTopic(items, 2);
    expect(out.items.map(i => i.title)).toEqual(['new single', 'old big story', 'tech', 'mine', 'mine 2']);
    expect(out.dropped).toBe(1);
  });

  it('per topic: a story without a date ranks last instead of breaking the sort', () => {
    const items = [item({ title: 'undated', published: null }), item({ title: 'dated', published: '2026-10-16T09:00:00Z' }), item({ title: 'garbage', published: 'not a date' })];
    expect(limitPerTopic(items, 1).items.map(i => i.title)).toEqual(['dated']);
  });
});
