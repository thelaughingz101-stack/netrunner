import { beforeEach, describe, expect, it } from 'vitest';
import { freshState } from './helpers.js';
import { buildApp } from '../src/server/app.js';
import { buildFetchUrl, extractChannelId, resolveYoutube } from '../src/sources/youtubeResolve.js';

describe('digest history API', () => {
  beforeEach(() => freshState());

  it('saves, lists newest-first, and deletes', async () => {
    const app = await buildApp();
    const a = (await app.inject({ method: 'POST', url: '/api/digests', payload: { date: '2026-10-01', mode: 'morning', content: '# a' } })).json();
    const b = (await app.inject({ method: 'POST', url: '/api/digests', payload: { date: '2026-10-02', mode: 'nightly', content: '# b' } })).json();
    const list = (await app.inject({ method: 'GET', url: '/api/digests' })).json().digests;
    expect(list.map((d: { id: number }) => d.id)).toEqual([b.id, a.id]);
    expect((await app.inject({ method: 'DELETE', url: `/api/digests/${a.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/digests/${a.id}` })).statusCode).toBe(404);
  });

  it('rejects a malformed date', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/digests', payload: { date: 'yesterday', mode: 'x', content: 'y' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('YouTube resolver (port of the n8n sub-workflow)', () => {
  it('passes a raw channel id straight through', () => {
    expect(buildFetchUrl('UCKy1dAqELo0zrOtPkf0eTMw')).toEqual({ channelId: 'UCKy1dAqELo0zrOtPkf0eTMw' });
  });

  it('turns handles into channel URLs', () => {
    expect(buildFetchUrl('mkbhd')).toEqual({ fetchUrl: 'https://www.youtube.com/@mkbhd' });
    expect(buildFetchUrl('@mkbhd')).toEqual({ fetchUrl: 'https://www.youtube.com/@mkbhd' });
    expect(buildFetchUrl('https://youtube.com/@x')).toEqual({ fetchUrl: 'https://youtube.com/@x' });
  });

  it('extracts the id and handle from channel HTML', () => {
    const html = '<link rel="canonical" href="https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ">..."canonicalBaseUrl":"/@mkbhd"';
    expect(extractChannelId(html)).toEqual({ channelId: 'UCBJycsmduvYEL83R_U4JriQ', handle: '@mkbhd', title: null, avatar: null });
    expect(extractChannelId('<html></html>')).toHaveProperty('error');
  });

  it('resolves end-to-end with an injected fetch', async () => {
    const fake = (async () => new Response('"externalId":"UCBJycsmduvYEL83R_U4JriQ"')) as unknown as typeof fetch;
    expect(await resolveYoutube('mkbhd', fake)).toEqual({ channelId: 'UCBJycsmduvYEL83R_U4JriQ', handle: null, title: null, avatar: null });
  });

  it('picks up the channel name and avatar so the UI can confirm the match', () => {
    const html = '<meta property="og:title" content="Marques Brownlee &amp; Co"><meta property="og:image" content="https://yt3.ggpht.com/abc=s900">"externalId":"UCBJycsmduvYEL83R_U4JriQ"';
    expect(extractChannelId(html)).toMatchObject({ title: 'Marques Brownlee & Co', avatar: 'https://yt3.ggpht.com/abc=s900' });
  });
});
