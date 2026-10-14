import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EDITABLE } from '../src/secrets.js';
import { buildApp } from '../src/server/app.js';
import { openSecrets, readSecretFiles, sealSecrets, setVaultSecrets, useVaultForTests, VAULT_KEYS, vaultProblems, type KeyProtector } from '../src/vault.js';
import { freshState } from './helpers.js';

// Stands in for the TPM: wraps with a fixed AES key, and can be told to fail like a cleared TPM.
function fakeTpm() {
  const kek = crypto.randomBytes(32);
  const p = {
    fail: false,
    wraps: 0,
    wrap(key: Buffer) {
      p.wraps++;
      const c = crypto.createCipheriv('aes-256-ecb', kek, null);
      return { protection: 'tpm' as const, wrapped: Buffer.concat([c.update(key), c.final()]) };
    },
    unwrap(_: string, wrapped: Buffer) {
      if (p.fail) throw new Error('The TPM key does not exist');
      const d = crypto.createDecipheriv('aes-256-ecb', kek, null);
      return Buffer.concat([d.update(wrapped), d.final()]);
    },
  };
  return p satisfies KeyProtector;
}

const GEMINI = 'AIzaSyVAULTTEST000011112222';
const HOOK = 'https://discord.com/api/webhooks/1/secret-token';

describe('secrets vault', () => {
  let dir: string;
  let vaultFile: string;
  let envPath: string;
  const saved = { ...process.env };

  beforeEach(() => {
    freshState();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-vault-'));
    vaultFile = path.join(dir, 'secrets.enc');
    envPath = path.join(dir, '.env');
    process.env.NETRUNNER_ENV_FILE = envPath;
    for (const k of VAULT_KEYS) delete process.env[k];
  });
  afterEach(() => {
    useVaultForTests(null);
    process.env = { ...saved };
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('vaults exactly the keys the app treats as secret', () => {
    const secret = Object.entries(EDITABLE).filter(([, v]) => v.secret).map(([k]) => k);
    expect([...VAULT_KEYS].sort()).toEqual(secret.sort());
  });

  it('round-trips, and refuses a file that was tampered with', () => {
    const dk = { key: crypto.randomBytes(32), protection: 'tpm' as const, wrapped: Buffer.from('w') };
    const sealed = sealSecrets({ GEMINI_API_KEY: GEMINI }, dk);
    expect(JSON.stringify(sealed)).not.toContain(GEMINI);
    expect(openSecrets(sealed, dk.key)).toEqual({ GEMINI_API_KEY: GEMINI });
    const data = Buffer.from(sealed.data, 'base64');
    data[0] ^= 1;
    expect(() => openSecrets({ ...sealed, data: data.toString('base64') }, dk.key)).toThrow();
    expect(() => openSecrets(sealed, crypto.randomBytes(32))).toThrow();
  });

  it('moves plain-text secrets out of .env on start and leaves everything else alone', () => {
    fs.writeFileSync(envPath, `# mine\nPORT=8787\nGEMINI_API_KEY=${GEMINI}\nDISCORD_WEBHOOK_URL=${HOOK}\nSMTP_USER=me@example.com\n`);
    const tpm = fakeTpm();
    useVaultForTests({ file: vaultFile, protector: tpm });

    const envText = fs.readFileSync(envPath, 'utf8');
    expect(envText).not.toContain(GEMINI);
    expect(envText).not.toContain('secret-token');
    expect(envText).toContain('GEMINI_API_KEY=\n');
    expect(envText).toContain('# mine\nPORT=8787\n');
    expect(envText).toContain('SMTP_USER=me@example.com');
    expect(envText).toMatch(/^# GEMINI_API_KEY, ANTHROPIC_API_KEY/);

    const raw = fs.readFileSync(vaultFile, 'utf8');
    expect(raw).not.toContain(GEMINI);
    expect(JSON.parse(raw).protection).toBe('tpm');

    // Next start: .env has blanks, the vault fills them in.
    for (const k of VAULT_KEYS) delete process.env[k];
    useVaultForTests({ file: vaultFile, protector: tpm });
    expect(process.env.GEMINI_API_KEY).toBe(GEMINI);
    expect(process.env.DISCORD_WEBHOOK_URL).toBe(HOOK);
    expect(tpm.wraps).toBe(1); // the data key is made once, not on every start
  });

  it('a real environment variable wins over the vault', () => {
    fs.writeFileSync(envPath, `GEMINI_API_KEY=${GEMINI}\n`);
    const tpm = fakeTpm();
    useVaultForTests({ file: vaultFile, protector: tpm });
    process.env.GEMINI_API_KEY = 'from-the-environment';
    useVaultForTests({ file: vaultFile, protector: tpm });
    expect(process.env.GEMINI_API_KEY).toBe('from-the-environment');
  });

  it("keeps a vault it can't unlock until a new key is saved, then sets it aside", () => {
    fs.writeFileSync(envPath, `GEMINI_API_KEY=${GEMINI}\n`);
    const tpm = fakeTpm();
    useVaultForTests({ file: vaultFile, protector: tpm });
    delete process.env.GEMINI_API_KEY;

    tpm.fail = true; // e.g. the TPM was cleared
    useVaultForTests({ file: vaultFile, protector: tpm });
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(fs.existsSync(vaultFile)).toBe(true);
    // The app shows this when it opens, so the person knows why their keys are gone and what to do.
    expect(vaultProblems().join(' ')).toMatch(/couldn't be unlocked \(The TPM key does not exist\).*Enter your keys again/);

    // While it's locked, a key in .env is used as-is but not moved into a new vault over the old one.
    fs.writeFileSync(envPath, 'GEMINI_API_KEY=AIzaSyNEWKEYAFTERRESET9999\n');
    useVaultForTests({ file: vaultFile, protector: tpm });
    expect(fs.readFileSync(envPath, 'utf8')).toContain('AIzaSyNEWKEYAFTERRESET9999');
    expect(fs.readdirSync(dir).some(f => f.startsWith('secrets.enc.unreadable-'))).toBe(false);

    // Saving in the app retries the unlock; still locked → the old vault is set aside, not destroyed.
    setVaultSecrets({ GEMINI_API_KEY: 'AIzaSyNEWKEYAFTERRESET9999' });
    expect(fs.readdirSync(dir).some(f => f.startsWith('secrets.enc.unreadable-'))).toBe(true);
    tpm.fail = false;
    delete process.env.GEMINI_API_KEY;
    fs.writeFileSync(envPath, '');
    useVaultForTests({ file: vaultFile, protector: tpm });
    expect(process.env.GEMINI_API_KEY).toBe('AIzaSyNEWKEYAFTERRESET9999');
  });

  it('a passing unlock failure loses nothing: saving retries and keeps the other keys', () => {
    fs.writeFileSync(envPath, `GEMINI_API_KEY=${GEMINI}\nDISCORD_WEBHOOK_URL=${HOOK}\n`);
    const tpm = fakeTpm();
    useVaultForTests({ file: vaultFile, protector: tpm });
    tpm.fail = true; // e.g. PowerShell timed out once
    useVaultForTests({ file: vaultFile, protector: tpm });
    tpm.fail = false;
    setVaultSecrets({ SMTP_PASS: 'abcd efgh ijkl mnop' });
    for (const k of VAULT_KEYS) delete process.env[k];
    useVaultForTests({ file: vaultFile, protector: tpm });
    expect(process.env.GEMINI_API_KEY).toBe(GEMINI);
    expect(process.env.DISCORD_WEBHOOK_URL).toBe(HOOK);
    expect(process.env.SMTP_PASS).toBe('abcd efgh ijkl mnop');
    expect(fs.readdirSync(dir).some(f => f.startsWith('secrets.enc.unreadable-'))).toBe(false);
  });

  it('moves a key out of .env even when it appears twice', () => {
    fs.writeFileSync(envPath, `GEMINI_API_KEY=old\nPORT=8787\nGEMINI_API_KEY=${GEMINI}\n`);
    useVaultForTests({ file: vaultFile, protector: fakeTpm() });
    const envText = fs.readFileSync(envPath, 'utf8');
    expect(envText).not.toContain(GEMINI);
    expect(envText).not.toContain('GEMINI_API_KEY=old');
    expect(process.env.GEMINI_API_KEY).toBe(GEMINI);
  });

  it("a failed move out of .env leaves the keys working and says why, instead of stopping the app", () => {
    fs.writeFileSync(envPath, `GEMINI_API_KEY=${GEMINI}
`);
    process.env.GEMINI_API_KEY = GEMINI;
    const broken: KeyProtector = { wrap: () => { throw new Error('TPM is locked out'); }, unwrap: () => Buffer.alloc(0) };
    expect(() => useVaultForTests({ file: vaultFile, protector: broken })).not.toThrow();
    expect(process.env.GEMINI_API_KEY).toBe(GEMINI);
    expect(fs.readFileSync(envPath, 'utf8')).toContain(GEMINI);
    expect(vaultProblems().join(' ')).toMatch(/couldn't be moved into encrypted storage \(TPM is locked out\)/);
  });

  it('Docker secrets: <KEY>_FILE reads the key from a file unless the key is already set', () => {
    const secretFile = path.join(dir, 'gemini_api_key.txt');
    fs.writeFileSync(secretFile, `${GEMINI}
`);
    process.env.GEMINI_API_KEY_FILE = secretFile;
    process.env.DISCORD_WEBHOOK_URL_FILE = path.join(dir, 'missing.txt');
    readSecretFiles();
    expect(process.env.GEMINI_API_KEY).toBe(GEMINI);
    expect(process.env.DISCORD_WEBHOOK_URL).toBeUndefined();
    process.env.GEMINI_API_KEY = 'set-directly';
    readSecretFiles();
    expect(process.env.GEMINI_API_KEY).toBe('set-directly');
  });

  it('saving from the app puts secrets in the vault and other settings in .env', async () => {
    fs.writeFileSync(envPath, '# test\nGEMINI_API_KEY=\nSMTP_HOST=\n');
    const tpm = fakeTpm();
    useVaultForTests({ file: vaultFile, protector: tpm });
    const app = await buildApp();

    const res = await app.inject({ method: 'PUT', url: '/api/keys', payload: { GEMINI_API_KEY: GEMINI, SMTP_HOST: 'smtp.gmail.com' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().keyStorage).toBe('tpm');
    expect(res.json().keys.GEMINI_API_KEY).toEqual({ set: true, hint: '2222' });
    expect(fs.readFileSync(envPath, 'utf8')).toBe('# test\nGEMINI_API_KEY=\nSMTP_HOST=smtp.gmail.com\n');
    expect(fs.readFileSync(vaultFile, 'utf8')).not.toContain(GEMINI);

    delete process.env.GEMINI_API_KEY;
    useVaultForTests({ file: vaultFile, protector: tpm });
    expect(process.env.GEMINI_API_KEY).toBe(GEMINI);

    // A plain copy typed into .env while the app runs must not undo the next save on restart.
    fs.writeFileSync(envPath, '# test\nGEMINI_API_KEY=AIzaSyTYPEDBYHANDOLD0000\nSMTP_HOST=smtp.gmail.com\n');
    expect((await app.inject({ method: 'PUT', url: '/api/keys', payload: { GEMINI_API_KEY: GEMINI } })).statusCode).toBe(200);
    expect(fs.readFileSync(envPath, 'utf8')).toBe('# test\nGEMINI_API_KEY=\nSMTP_HOST=smtp.gmail.com\n');

    expect((await app.inject({ method: 'PUT', url: '/api/keys', payload: { GEMINI_API_KEY: '' } })).statusCode).toBe(200);
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    useVaultForTests({ file: vaultFile, protector: tpm });
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  });
});
