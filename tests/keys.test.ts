import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/env.js';
import { applyEnvUpdates } from '../src/secrets.js';
import { buildApp, hostAllowed } from '../src/server/app.js';
import { freshState } from './helpers.js';

describe('applyEnvUpdates (pure)', () => {
  const text = '# comment\nGEMINI_API_KEY=old\n\n# Delivery\nDISCORD_WEBHOOK_URL=\nOTHER=keep\n';
  it('replaces in place, keeps comments and other lines', () => {
    expect(applyEnvUpdates(text, { GEMINI_API_KEY: 'new', DISCORD_WEBHOOK_URL: 'https://x/y' }))
      .toBe('# comment\nGEMINI_API_KEY=new\n\n# Delivery\nDISCORD_WEBHOOK_URL=https://x/y\nOTHER=keep\n');
  });
  it('appends missing keys and clears with ""', () => {
    const out = applyEnvUpdates(text, { SMTP_PASS: 'abcd efgh', GEMINI_API_KEY: '' });
    expect(out).toContain('GEMINI_API_KEY=\n');
    expect(out.trimEnd().endsWith('SMTP_PASS="abcd efgh"')).toBe(true);
  });
});

describe('/api/keys', () => {
  const file = path.join(os.tmpdir(), `netrunner-env-${process.pid}.env`);
  const saved = { ...process.env };
  beforeAll(() => {
    freshState();
    fs.writeFileSync(file, '# test\nGEMINI_API_KEY=\nOTHER=1\n');
    process.env.NETRUNNER_ENV_FILE = file;
    delete process.env.GEMINI_API_KEY;
  });
  afterAll(() => { process.env = saved; fs.rmSync(file, { force: true }); });

  it('saves a key to .env, applies it, and never returns the value', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: '/api/keys', payload: { GEMINI_API_KEY: 'AIzaSyTESTKEY1234wxyz' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('AIzaSyTESTKEY1234wxyz');
    expect(res.json().keys.GEMINI_API_KEY).toEqual({ set: true, hint: 'wxyz' });
    expect(res.json().secrets.gemini).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('# test\nGEMINI_API_KEY=AIzaSyTESTKEY1234wxyz\nOTHER=1\n');
    expect(env().GEMINI_API_KEY).toBe('AIzaSyTESTKEY1234wxyz');
    const cfg = await app.inject({ method: 'GET', url: '/api/config' });
    expect(cfg.body).not.toContain('AIzaSyTESTKEY1234wxyz');
  });

  it('refuses keys outside the allow-list and values with quotes', async () => {
    const app = await buildApp();
    expect((await app.inject({ method: 'PUT', url: '/api/keys', payload: { HOST: '0.0.0.0' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/keys', payload: { SMTP_PASS: 'a"b' } })).statusCode).toBe(400);
  });

  it('refuses writes from another website (Origin mismatch)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: '/api/keys', headers: { origin: 'https://evil.example', host: '127.0.0.1:8787' }, payload: { GEMINI_API_KEY: 'x' } });
    expect(res.statusCode).toBe(403);
    const ok = await app.inject({ method: 'PUT', url: '/api/keys', headers: { origin: 'http://127.0.0.1:8787', host: '127.0.0.1:8787' }, payload: { OLLAMA_URL: 'http://localhost:11434' } });
    expect(ok.statusCode).toBe(200);
  });

  it('refuses writes from another device on the LAN', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: '/api/keys', remoteAddress: '192.168.1.50', payload: { GEMINI_API_KEY: 'x' } });
    expect(res.statusCode).toBe(403);
  });

  it('refuses DNS rebinding: a domain name in Host, even same-origin from loopback', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: '/api/keys', headers: { host: 'attacker.example:8787', origin: 'http://attacker.example:8787' }, payload: { DISCORD_WEBHOOK_URL: 'https://evil/x' } });
    expect(res.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/config', headers: { host: 'attacker.example:8787' } })).statusCode).toBe(403);
    for (const ok of ['127.0.0.1:8787', 'localhost:8787', '[::1]:8787', '192.168.1.20:8787']) expect(hostAllowed(ok)).toBe(true);
    for (const bad of ['attacker.example', 'localhost.attacker.example:8787', undefined]) expect(hostAllowed(bad)).toBe(false);
  });

  it('refuses values that would stop NetRunner from starting, and leaves .env untouched', async () => {
    const app = await buildApp();
    const before = fs.readFileSync(file, 'utf8');
    for (const payload of [{ SMTP_PORT: 'smtp' }, { SMTP_SECURE: 'yes' }]) {
      expect((await app.inject({ method: 'PUT', url: '/api/keys', payload })).statusCode).toBe(400);
    }
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(() => env()).not.toThrow();
    expect((await app.inject({ method: 'PUT', url: '/api/keys', payload: { SMTP_PORT: '587' } })).statusCode).toBe(200);
  });
});
