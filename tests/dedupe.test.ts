import { describe, expect, it } from 'vitest';
import { clusterSameStory, dedupeAndSort, mergeAcrossCategories } from '../src/pipeline/ingest/filters.js';
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

describe('Cross-category merging (new; not in n8n)', () => {
  // Real headline pairs from digests that put the same story in two sections.
  const SAME = [
    ['World News', 'South African judge Navi Pillay wins 2026 Nobel Peace Prize', 'US Politics', 'Navi Pillay wins the Nobel Peace Prize for her work in international justice'],
    ['Gaming', 'Live-action Cyberpunk 2077 film reportedly in development, with CD Projekt Red producing', 'Leaks & Rumors', 'Cyberpunk 2077 is getting a live-action movie from Paramount'],
    ['Tech & Hardware', 'Webb telescope detects galaxy origin of the farthest fast radio burst ever', 'Science & Space', 'Webb Measures Distance to Farthest Fast Radio Burst, Suggesting Origin'],
    ['World News', 'ICE agent shoots man in New York City', 'US Politics', 'ICE Agent Shoots Man During Arrest Attempt in New York Neighborhood'],
    ['World News', "Crazy Rich Asians to return as TV show with original film's stars", 'TV & Movies', "‘Crazy Rich Asians’ Series Ordered at HBO with Film’s Original Cast Returning"],
  ];
  // Real near-misses that are different stories.
  const DIFFERENT = [
    ['Gaming', 'Hi there', 'US Politics', 'There it is: hi from the Senate floor'],
    ['World News', 'Manchester City charges: Maresca says Premier League club will win appeal', 'Business & Finance', 'Manchester City: too big to fail?'],
    ['Gaming', "Forza Horizon 6's first major expansion will pull up in January", 'Leaks & Rumors', 'Forza Horizon 6 officially dated for PS5, alongside an expansion reveal'],
    ['Gaming', 'For the first time in the series, Grand Theft Auto 6 lets you use headphones to listen to radio stations and podcasts', 'Notable Trends', 'The Music of Grand Theft Auto VI'],
    ['Tech & Hardware', 'Everything Crunchyroll Announced at New York Comic Con 2026', 'Media Announcements', 'Marvel Booth Tour | New York Comic Con (NYCC) 2026'],
  ];

  it.each(SAME)('merges the same story across sections: [%s] %s', (c1, t1, c2, t2) => {
    const { items, merged } = mergeAcrossCategories([
      item({ category: c1, title: t1, source: 'A', link: 'l1' }),
      item({ category: c2, title: t2, source: 'B', link: 'l2' }),
    ]);
    expect(merged).toBe(1);
    expect(items[0]).toMatchObject({ category: c1, source: 'A, B', clusterSize: 2, clusterLinks: ['l1', 'l2'] });
  });

  it.each(DIFFERENT)('keeps different stories apart: [%s] %s', (c1, t1, c2, t2) => {
    const { merged } = mergeAcrossCategories([item({ category: c1, title: t1 }), item({ category: c2, title: t2 })]);
    expect(merged).toBe(0);
  });

  it('adds onto an existing same-category cluster instead of nesting it', () => {
    const { items } = mergeAcrossCategories([
      item({ category: 'World News', title: 'South African judge Navi Pillay wins 2026 Nobel Peace Prize', source: 'Reuters, NPR World', clusterSize: 2, clusterLinks: ['r', 'n'] }),
      item({ category: 'US Politics', title: 'Navi Pillay wins the Nobel Peace Prize for her work in international justice', source: 'AP News', link: 'ap' }),
    ]);
    expect(items[0]).toMatchObject({ source: 'Reuters, NPR World, AP News', clusterSize: 3, clusterLinks: ['r', 'n', 'ap'] });
  });

  it('files the merged story under a real section rather than Custom Feeds', () => {
    const { items } = mergeAcrossCategories([
      item({ category: 'Custom Feeds', title: 'Trump Administration Suspends Microsoft From Green Card Program', source: 'nytimes.com' }),
      item({ category: 'Tech & Hardware', title: 'Trump Admin Suspends Microsoft From Sponsoring Green Card Holders', source: "Tom's Hardware" }),
    ]);
    expect(items[0].category).toBe('Tech & Hardware');
  });

  it("doesn't file a confirmed story as a rumor just because the rumor copy is newer", () => {
    const { items } = mergeAcrossCategories([
      item({ category: 'Leaks & Rumors', title: 'Cyberpunk 2077 live-action movie confirmed by Paramount and CD Projekt', source: 'Insider Gaming' }),
      item({ category: 'Gaming', title: 'CD Projekt and Paramount confirm Cyberpunk 2077 live-action movie', source: 'IGN' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe('Gaming');
    expect(items[0].source).toBe('Insider Gaming, IGN');
  });

  it('leaves same-category pairs to clusterSameStory', () => {
    const { merged } = mergeAcrossCategories([
      item({ category: 'Gaming', title: 'Cyberpunk 2077 is getting a live-action movie from Paramount' }),
      item({ category: 'Gaming', title: 'Cyberpunk 2077 is getting a live-action movie from Paramount' }),
    ]);
    expect(merged).toBe(0);
  });
});
