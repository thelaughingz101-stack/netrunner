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
    for (const ep of ['/api/config', '/api/run', '/api/run/status', '/api/prompt', '/api/digests', '/api/health', '/api/resolve-youtube']) {
      expect(src, ep).toContain(ep);
    }
    expect(html).toContain('/api/catalog');
  });

  it('never renders secret values', () => {
    expect(src).not.toMatch(/llm\.apiKeys|delivery\.discordWebhookUrl/);
  });

  it('can export and import settings, and "Load" is now "Undo changes"', () => {
    expect(src).toContain('Export settings');
    expect(src).toContain('Import settings');
    expect(src).toContain('/api/config/import');
    expect(src).toContain('Undo changes');
    expect(src).not.toMatch(/>\s*Load\s*</);
  });

  it('loads only vendored scripts', () => {
    expect(html).not.toMatch(/<script[^>]+src="https?:/);
  });
});

describe('uniformity pass (Oct 2026)', () => {
  it('is a dashboard, not a wizard: no Back / Next / Finish, one connection indicator', () => {
    for (const gone of ['← Back', 'Next →', 'Finish ✓', 'Connected to local server', 'goNext', 'goPrev']) expect(src, gone).not.toContain(gone);
    expect(src).toContain('server offline: reopen NetRunner');
  });

  it('Save and Undo follow unsaved changes; Schedule says when edits are not scheduled yet', () => {
    expect(src).toContain('Unsaved changes');
    expect(src).toMatch(/disabled=\{!dirty\}/);
    expect(src).toMatch(/disabled=\{!canSave\}/);
    expect(src).toContain('Not scheduled yet');
  });

  it('the Excluded list toggle lives in one place, without icon prefixes', () => {
    expect(src.match(/format\.showExcluded", v\)/g)).toHaveLength(1);
    expect(src).not.toMatch(/label="(📋|🗒️) /);
  });

  it('shows full source names and the running digest step on hover', () => {
    expect(src).toContain('LABELS[src] || src');
    expect(src).toContain('function RunButton');
    expect(src).not.toContain('<ActionBar />');
  });
});
