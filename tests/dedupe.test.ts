import { describe, expect, it } from 'vitest';
import { clusterSameStory, dedupeAndSort } from '../src/pipeline/ingest/filters.js';
import type { Item } from '../src/pipeline/types.js';

const item = (p: Partial<Item>): Item => ({ mode: 'morning', source: 'S', category: 'Gaming', title: 't', link: '', published: null, summary: '', ...p });

describe('Dedup + Sort (port of the n8n node)', () => {
  it('drops exact duplicate links, case-insensitively, keeping the first seen', () => {
    const { items, duplicates } = dedupeAndSort([
      item({ link: 'https://ign.com/A', title: 'first', published: '2026-10-08T10:00:00Z' }),
      item({ link: 'https://IGN.com/a', title: 'dupe', published: '2026-10-08T11:00:00Z' }),
    ]);
    expect(duplicates).toBe(1);
    expect(items.map(i => i.title)).toEqual(['first']);
  });

  it('falls back to the title as the key when there is no link', () => {
    const { items } = dedupeAndSort([
      item({ title: 'Same Headline' }), item({ title: 'same headline' }), item({ title: 'Other' }),
    ]);
    expect(items.map(i => i.title)).toEqual(['Same Headline', 'Other']);
  });

  it('treats the same story from two outlets (different links) as NOT a duplicate', () => {
    const { items, duplicates } = dedupeAndSort([
      item({ link: 'https://ign.com/gta6', title: 'GTA 6 trailer' }),
      item({ link: 'https://kotaku.com/gta6', title: 'GTA 6 trailer' }),
    ]);
    expect(duplicates).toBe(0);
    expect(items).toHaveLength(2);
  });

  it('sorts newest first', () => {
    const { items } = dedupeAndSort([
      item({ link: 'a', published: '2026-10-08T08:00:00Z' }),
      item({ link: 'b', published: '2026-10-08T12:00:00Z' }),
      item({ link: 'c', published: '2026-10-08T10:00:00Z' }),
    ]);
    expect(items.map(i => i.link)).toEqual(['b', 'c', 'a']);
  });

  it('handles an empty input', () => {
    expect(dedupeAndSort([])).toEqual({ items: [], duplicates: 0 });
  });
});

describe('Same-Story Clustering (port of the n8n node)', () => {
  it('merges same-category items with overlapping headline keywords', () => {
    const { items, merged } = clusterSameStory([
      item({ source: 'IGN', title: 'Rockstar reveals Grand Theft Auto trailer date', link: 'l1' }),
      item({ source: 'Kotaku', title: 'Grand Theft Auto trailer date revealed by Rockstar', link: 'l2' }),
      item({ source: 'Polygon', title: 'Nintendo announces new Zelda remaster', link: 'l3' }),
    ]);
    expect(merged).toBe(1);
    expect(items[0]).toMatchObject({ source: 'IGN, Kotaku', clusterSize: 2, clusterLinks: ['l1', 'l2'] });
    expect(items[1].source).toBe('Polygon');
  });

  it('never clusters across categories', () => {
    const { merged } = clusterSameStory([
      item({ category: 'Gaming', title: 'Nvidia launches RTX graphics card lineup' }),
      item({ category: 'Tech & Hardware', title: 'Nvidia launches RTX graphics card lineup' }),
    ]);
    expect(merged).toBe(0);
  });
});
