import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const Babel = require('@babel/standalone');
const html = fs.readFileSync(path.resolve(__dirname, '../public/netrunner-config.html'), 'utf8');
const src = html.slice(html.indexOf('<script id="nr-src" type="text/plain">') + 38, html.indexOf('</script>', html.indexOf('id="nr-src"')));

describe('netrunner-config.html', () => {
  it('JSX compiles with the same Babel preset the page uses', () => {
    expect(() => Babel.transform(src, { filename: 'app.jsx', presets: [['react', { runtime: 'classic' }]] })).not.toThrow();
  });

  it('no longer talks to n8n, webhooks, or the file picker for config', () => {
    for (const gone of ['localhost:5678', 'webhookUrl', 'editWebhookUrl', 'nr_webhook', 'nr_output_entries', 'netrunner-resolve-yt', 'XMLHttpRequest', 'showSaveFilePicker']) {
      expect(src, gone).not.toContain(gone);
    }
  });

  it('calls every API endpoint the server exposes for it', () => {
    for (const ep of ['/api/config', '/api/run', '/api/prompt', '/api/digests', '/api/health', '/api/resolve-youtube']) {
      expect(src, ep).toContain(ep);
    }
    expect(html).toContain('/api/catalog');
  });

  it('never renders secret values', () => {
    expect(src).not.toMatch(/llm\.apiKeys|delivery\.discordWebhookUrl/);
  });

  it('loads only vendored scripts', () => {
    expect(html).not.toMatch(/<script[^>]+src="https?:/);
  });
});
