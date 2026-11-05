import { beforeEach, describe, expect, it } from 'vitest';
import { MODEL_NAME, pullState, sameModel, startPull } from '../src/localAi.js';
import { buildApp } from '../src/server/app.js';
import { freshState } from './helpers.js';

/** Ollama's /api/pull answer: one JSON line per update, a model in several files ("layers"). */
const pullAnswer = (lines: object[]) => (async () => new Response(lines.map(l => JSON.stringify(l)).join('\n') + '\n')) as unknown as typeof fetch;
const until = async (done: () => boolean) => { for (let i = 0; i < 100 && !done(); i++) await new Promise(r => setTimeout(r, 5)); };

describe('AI Writer → Local AI', () => {
  // Port 9 (discard): nothing answers, so Ollama reads as not running.
  beforeEach(() => freshState({ OLLAMA_URL: 'http://127.0.0.1:9', OLLAMA_MODEL: 'smollm2:1.7b-instruct-q4_K_M' }));

  it('knows a model name when it sees one, with or without its tag', () => {
    for (const ok of ['smollm2:1.7b-instruct-q4_K_M', 'llama3.2', 'hf.co/bartowski/SmolLM2-1.7B-Instruct-GGUF:Q4_K_M']) expect(MODEL_NAME.test(ok), ok).toBe(true);
    for (const bad of ['', 'rm -rf /', '../etc', 'a b']) expect(MODEL_NAME.test(bad), bad).toBe(false);
    expect(sameModel('llama3.2', 'llama3.2:latest')).toBe(true);
    expect(sameModel('llama3.2:3b', 'llama3.2:latest')).toBe(false);
  });

  it('downloads a model and follows its progress across every file', async () => {
    startPull('tiny:1b', pullAnswer([
      { status: 'pulling manifest' },
      { status: 'pulling a', digest: 'sha256:a', total: 1000, completed: 400 },
      { status: 'pulling b', digest: 'sha256:b', total: 10, completed: 10 },
      { status: 'pulling a', digest: 'sha256:a', total: 1000, completed: 1000 },
      { status: 'success' },
    ]));
    await until(() => !!pullState()?.done);
    expect(pullState()).toMatchObject({ name: 'tiny:1b', status: 'success', total: 1010, completed: 1010, done: true });
    expect(pullState()!.error).toBeUndefined();
  });

  it('says plainly when Ollama has no model by that name, and refuses a second download at once', async () => {
    startPull('no-such-model', pullAnswer([{ status: 'pulling manifest' }, { error: 'pull model manifest: file does not exist' }]));
    await until(() => !!pullState()?.done);
    expect(pullState()!.error).toBe('Ollama has no model called no-such-model. Check the name on ollama.com/library.');
    startPull('slow:1b', (async () => new Promise(() => {})) as unknown as typeof fetch);
    expect(() => startPull('other:1b')).toThrow(/Already downloading slow:1b/);
    expect(() => startPull('not a name')).toThrow(/isn't a model name/);
  });

  it('shows the status to anyone, but only this computer can start Ollama or download models', async () => {
    const app = await buildApp();
    const status = await app.inject({ method: 'GET', url: '/api/local-ai' });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ running: false, chosen: 'smollm2:1.7b-instruct-q4_K_M', chosenInstalled: false, models: [] });
    expect(status.json().suggested[0]).toMatchObject({ name: 'smollm2:1.7b-instruct-q4_K_M', installed: false });
    for (const url of ['/api/local-ai/start', '/api/local-ai/pull']) {
      const res = await app.inject({ method: 'POST', url, remoteAddress: '192.168.1.50', payload: { name: 'tiny:1b' } });
      expect(res.statusCode, url).toBe(403);
    }
  });

  it('the model is shown like the other settings (it is not a secret)', async () => {
    const before = process.env.OLLAMA_MODEL;
    process.env.OLLAMA_MODEL = 'tiny:1b';
    try {
      const keys = await (await buildApp()).inject({ method: 'GET', url: '/api/keys' });
      expect(keys.json().keys.OLLAMA_MODEL).toEqual({ set: true, value: 'tiny:1b' });
    } finally {
      if (before === undefined) delete process.env.OLLAMA_MODEL; else process.env.OLLAMA_MODEL = before;
    }
  });
});

describe('Add your own → RSS: the feed is checked before it is saved', () => {
  it("finds the feed a site's page advertises", async () => {
    const { discoverFeed } = await import('../src/sources/feedResolve.js');
    expect(discoverFeed('<html><head><link rel="alternate" type="application/rss+xml" title="RSS" href="/rss/index.xml"></head>', 'https://www.theverge.com/')).toBe('https://www.theverge.com/rss/index.xml');
    expect(discoverFeed('<link rel="stylesheet" href="/a.css">', 'https://x.dev/')).toBeNull();
  });

  it('reads the title, size and newest story, or says plainly what is wrong', async () => {
    const { resolveFeed } = await import('../src/sources/feedResolve.js');
    const feed = '<?xml version="1.0"?><rss version="2.0"><channel><title>My &amp; Feed</title><link>https://my.dev/</link>'
      + '<item><title>Older</title><pubDate>Mon, 19 Oct 2026 10:00:00 GMT</pubDate></item><item><title>Newest &#8216;one&#8217;</title><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>';
    const answer = (status: number, text: string) => (async () => new Response(text, { status })) as unknown as typeof fetch;
    expect(await resolveFeed('my.dev/feed.xml', answer(200, feed))).toEqual({ url: 'https://my.dev/feed.xml', title: 'My & Feed', site: 'https://my.dev/', icon: 'https://my.dev/favicon.ico', items: 2, newest: '2026-10-26T10:00:00.000Z', newestTitle: 'Newest ‘one’' });
    expect(await resolveFeed('https://my.dev/x', answer(404, 'nope'))).toEqual({ error: 'The site answered HTTP 404. Check the address.' });
    expect(await resolveFeed('https://my.dev/', answer(200, '<html>no feed here</html>'))).toMatchObject({ error: expect.stringMatching(/isn't a feed/) });
  });
});
