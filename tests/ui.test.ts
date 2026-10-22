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

  it('Output: each topic folds open and shut, with Collapse all / Expand all, remembered between visits', () => {
    expect(src).toContain('function splitSections');
    expect(src).toMatch(/<details[^>]*className="md-sec"/);
    expect(src).toContain('Collapse all');
    expect(src).toContain('Expand all');
    expect(src).toContain('nr_collapsed');
  });

  it('shows full source names and the running digest step on hover', () => {
    expect(src).toContain('LABELS[src] || src');
    expect(src).toContain('function RunButton');
    expect(src).not.toContain('<ActionBar />');
  });
});

describe('Output reader (the page functions, run for real)', () => {
  const block = src.slice(src.indexOf('const HIDEABLE = ['), src.indexOf('function OutputTab('));
  const page = () => new Function(`${block}; return { viewDigest, splitSections, foldable };`)();

  it('saved copy-paste prompts stay one flat page: their ## lines are part of the prompt, not sections', () => {
    expect(page().foldable('manual-claude')).toBe(false);
    expect(page().foldable('manual')).toBe(false);
    expect(page().foldable('nightly')).toBe(true);
  });

  it('counts "* " bullets like "- " ones, so the Hide button and the fold agree', () => {
    const md = '## 📋 Everything Else\n* [**A**](u) — a. *(S)*\n* [**B**](u) — b. *(S)*';
    expect(page().viewDigest(md, {}).counts.everythingElse).toBe(2);
    expect(page().splitSections(md).sections[0].count).toBe(2);
  });
});

describe('digest rendering is safe (feed text reaches the page through the AI)', () => {
  const block = src.slice(src.indexOf('// Digest text comes from feeds'), src.indexOf('const MD_STYLE'));
  const renderMD = new Function(`${block}; return renderMD;`)();

  it('a link cannot break out of its href, and only http(s) links become links', () => {
    const html = renderMD('- [**Click**](https://x.dev/a" onmouseover="alert(1)) — hi');
    expect(html).not.toMatch(/"\s*onmouseover=/);
    expect(html).toContain('href="https://x.dev/a&quot; onmouseover=&quot;alert(1"');
    expect(renderMD('[x](javascript:alert(1))')).not.toContain('<a ');
    expect(renderMD('[x](data:text/html,hi)')).not.toContain('<a ');
    expect(renderMD('<img src=x onerror=alert(1)>')).not.toContain('<img');
    expect(renderMD('- [**Ok**](https://www.fda.gov/x) — fine')).toContain('<a class="md-link" href="https://www.fda.gov/x" target="_blank" rel="noopener noreferrer"><strong>Ok</strong></a>');
  });

  it('search highlighting marks text only, never inside a tag', () => {
    const reader = src.slice(src.indexOf('// Marks a search term'), src.indexOf('// Output tab search: every saved digest'));
    const highlightHTML = new Function(`${reader}; return highlightHTML;`)();
    expect(highlightHTML('<a class="md-link" href="https://zelda.dev">Zelda news</a>', 'zelda'))
      .toBe('<a class="md-link" href="https://zelda.dev"><mark class="md-mark">Zelda</mark> news</a>');
  });
});

describe('Oct 22 additions', () => {
  it('starting points: Everything on, Official only, Start fresh (no Entertainment or Light, nothing marked recommended)', () => {
    for (const t of ['Everything on', 'Official only', 'Start fresh']) expect(src, t).toContain(t);
    for (const gone of ['Entertainment only', 'id:"light", title', 'tag:"RECOMMENDED"']) expect(src, gone).not.toContain(gone);
    expect(src).toContain('function applyStartingPoint');
  });

  it('Sources can be searched and narrowed to official bodies; Output searches every digest; Run shows a forecast', () => {
    expect(src).toContain('Search sources');
    expect(src).toContain('Official bodies only');
    expect(src).toContain('/api/digests/search');
    expect(src).toContain('/api/estimate');
    expect(src).toContain('format.digestSize');
  });
});

describe('grader and feed health on screen', () => {
  it('Output shows the grade (and can grade a digest); Sources shows feed health; AI Writer can switch grading off', () => {
    expect(src).toContain('function GradePanel');
    expect(src).toContain('Grade this digest');
    expect(src).toMatch(/\/api\/digests\/\$\{entry\.id\}\/grade/);
    expect(src).toContain('function FeedHealthCard');
    expect(src).toContain('/api/feeds/health');
    expect(src).toContain('update("llm.grade", v)');
  });
});

describe('Add your own: Bluesky', () => {
  it('has a Bluesky box that checks the account before adding it', () => {
    expect(src).toContain('function BlueskyField');
    expect(src).toContain('/api/resolve-bluesky');
    expect(src).toContain('customSources.bluesky');
  });
});
