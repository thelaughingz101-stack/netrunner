// API keys, the Discord webhook and SMTP_PASS, encrypted at rest (Windows). They live in secrets.enc in
// the data folder, not in .env:
// - The values are encrypted with AES-256-GCM under a random 256-bit data key (GCM also detects tampering).
// - That data key is itself encrypted ("wrapped") by an RSA key generated inside this PC's TPM, which never
//   leaves the chip. Nobody picks or stores a password: only this Windows account on this PC can unwrap it,
//   so a copy of the file (cloud sync, a backup, another PC) is useless. No TPM → Windows DPAPI instead.
// - A value still typed into .env is moved in on the next start and blanked in .env.
// It doesn't stop software already running as this Windows user: that can ask Windows to unwrap, too.
// Off outside Windows. There (Docker / Pi), a key can instead come from a file with GEMINI_API_KEY_FILE=…
// (Docker secrets: mounted read-only at /run/secrets, never in .env, the image or `docker inspect`).
//
// Loaded by env.ts before anything reads process.env, so this file must not import app modules (or the
// logger): messages wait in a queue until logger.ts subscribes with onVaultNote().
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export const VAULT_KEYS = ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'DISCORD_WEBHOOK_URL', 'SMTP_PASS'] as const;
export type VaultKey = (typeof VAULT_KEYS)[number];
export type Secrets = Partial<Record<VaultKey, string>>;
export const isVaultKey = (k: string): k is VaultKey => (VAULT_KEYS as readonly string[]).includes(k);

export type Protection = 'tpm' | 'dpapi';
/** Wraps / unwraps the data key. Windows: TPM or DPAPI through PowerShell. Tests pass a fake. */
export interface KeyProtector {
  wrap(key: Buffer): { protection: Protection; wrapped: Buffer };
  unwrap(protection: Protection, wrapped: Buffer): Buffer;
}

interface VaultFile { v: 1; protection: Protection; key: string; iv: string; tag: string; data: string }
interface DataKey { key: Buffer; protection: Protection; wrapped: Buffer }

const AAD = Buffer.from('netrunner-secrets-v1');

// ── .env text (shared with secrets.ts) ──────────────────────────────────────────────────────────────

/** The .env dotenv loaded (cwd). NETRUNNER_ENV_FILE points tests at a scratch file. */
export const envFile = () => process.env.NETRUNNER_ENV_FILE || path.resolve(process.cwd(), '.env');

// dotenv doesn't unescape \" inside quotes, so values with quotes or line breaks are refused instead.
const quote = (v: string) => (/[\s#=]/.test(v) ? `"${v}"` : v);

/** Pure: rewrite .env text with the given values ('' clears a key). Unknown lines are untouched. A key
 *  that appears more than once gets the value on every line (dotenv would otherwise use the last one). */
export function applyEnvUpdates(text: string, updates: Partial<Record<string, string>>): string {
  const lines = text.split(/\r?\n/);
  const pending = new Map(Object.entries(updates));
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/);
    if (m && pending.has(m[1])) {
      lines[i] = `${m[1]}=${quote(pending.get(m[1])!)}`;
      seen.add(m[1]);
    }
  }
  for (const k of seen) pending.delete(k);
  if (pending.size) {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    for (const [k, v] of pending) lines.push(`${k}=${quote(v!)}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function writeFileAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

const ENV_NOTE = [
  '# GEMINI_API_KEY, ANTHROPIC_API_KEY, DISCORD_WEBHOOK_URL and SMTP_PASS are kept encrypted in secrets.enc',
  '# in the data folder, locked to this PC. Set them in the app; a value typed here moves there on the next start.',
].join('\n');

// ── Encryption (pure) ───────────────────────────────────────────────────────────────────────────────

export function sealSecrets(secrets: Secrets, dk: DataKey): VaultFile {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', dk.key, iv);
  c.setAAD(AAD);
  const data = Buffer.concat([c.update(JSON.stringify(secrets), 'utf8'), c.final()]);
  return { v: 1, protection: dk.protection, key: dk.wrapped.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/** Throws if the key is wrong or the file was altered (GCM auth tag). */
export function openSecrets(file: VaultFile, key: Buffer): Secrets {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
  d.setAAD(AAD);
  d.setAuthTag(Buffer.from(file.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(file.data, 'base64')), d.final()]).toString('utf8'));
}

// ── Windows key protector (TPM, else DPAPI) ─────────────────────────────────────────────────────────

// The RSA key is created once inside the TPM (Microsoft Platform Crypto Provider), per Windows user, and
// can't be exported. Data goes through stdin/stdout as base64, never on the command line.
const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Core, System.Security
$in = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$name = 'NetRunner Secrets'
$prov = [System.Security.Cryptography.CngProvider]::new('Microsoft Platform Crypto Provider')
$pad = [System.Security.Cryptography.RSAEncryptionPadding]::OaepSHA256
switch ($env:NR_VAULT_OP) {
  'tpm-wrap' {
    if ([System.Security.Cryptography.CngKey]::Exists($name, $prov)) { $k = [System.Security.Cryptography.CngKey]::Open($name, $prov) }
    else {
      $p = [System.Security.Cryptography.CngKeyCreationParameters]::new()
      $p.Provider = $prov
      $p.Parameters.Add([System.Security.Cryptography.CngProperty]::new('Length', [BitConverter]::GetBytes(2048), [System.Security.Cryptography.CngPropertyOptions]::None))
      $k = [System.Security.Cryptography.CngKey]::Create([System.Security.Cryptography.CngAlgorithm]::Rsa, $name, $p)
    }
    $out = [System.Security.Cryptography.RSACng]::new($k).Encrypt($in, $pad)
  }
  'tpm-unwrap' {
    $k = [System.Security.Cryptography.CngKey]::Open($name, $prov)
    $out = [System.Security.Cryptography.RSACng]::new($k).Decrypt($in, $pad)
  }
  'dpapi-wrap' { $out = [System.Security.Cryptography.ProtectedData]::Protect($in, $null, 'CurrentUser') }
  'dpapi-unwrap' { $out = [System.Security.Cryptography.ProtectedData]::Unprotect($in, $null, 'CurrentUser') }
  default { throw "unknown op $($env:NR_VAULT_OP)" }
}
[Console]::Out.Write([Convert]::ToBase64String($out))
`;
const PS_ENCODED = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');

function powershell(op: string, input: Buffer): Buffer {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', PS_ENCODED], {
    input: input.toString('base64'), env: { ...process.env, NR_VAULT_OP: op }, windowsHide: true, encoding: 'utf8', timeout: 20_000,
  });
  return Buffer.from(out.trim(), 'base64');
}

const firstLine = (e: unknown) => {
  const err = e as { stderr?: string; message?: string };
  return (err.stderr?.trim() || err.message || String(e)).split(/\r?\n/)[0];
};

export const windowsProtector: KeyProtector = {
  wrap(key) {
    try {
      const wrapped = powershell('tpm-wrap', key);
      // Some TPMs encrypt fine but can't decrypt (key usage, OAEP support): prove it before relying on it.
      if (!powershell('tpm-unwrap', wrapped).equals(key)) throw new Error('the TPM returned a different key');
      return { protection: 'tpm', wrapped };
    } catch (e) {
      note('warn', `no usable TPM (${firstLine(e)}); secrets are locked with Windows DPAPI to this Windows account instead`);
      return { protection: 'dpapi', wrapped: powershell('dpapi-wrap', key) };
    }
  },
  unwrap: (protection, wrapped) => powershell(`${protection}-unwrap`, wrapped),
};

// ── State ───────────────────────────────────────────────────────────────────────────────────────────

let active: { file: string; protector: KeyProtector } | null = null;
let dataKey: DataKey | null = null;
let current: Secrets = {};

type Note = { level: 'info' | 'warn'; msg: string };
const queued: Note[] = [];
let listener: ((n: Note) => void) | null = null;
function note(level: Note['level'], msg: string) {
  if (listener) listener({ level, msg }); else queued.push({ level, msg });
}
// Problems the person needs to act on, in plain words. The app shows them when it opens.
let problems: string[] = [];
function problem(msg: string) {
  problems.push(msg);
  note('warn', msg);
}
export const vaultProblems = () => [...problems];
/** logger.ts subscribes once it exists; notes from before that are delivered then. */
export function onVaultNote(fn: (n: Note) => void): void {
  listener = fn;
  for (const n of queued.splice(0)) fn(n);
}

/** <KEY>_FILE: read the secret from that file (Docker secrets) unless the key itself is already set. */
export function readSecretFiles(): void {
  for (const k of VAULT_KEYS) {
    const file = process.env[`${k}_FILE`]?.trim();
    if (!file || process.env[k]?.trim()) continue;
    try { process.env[k] = fs.readFileSync(file, 'utf8').trim(); }
    catch (e) { problem(`${k} couldn't be read from ${file} (${k}_FILE): ${firstLine(e)}`); }
  }
}

/** Called by env.ts right after dotenv: decrypts into process.env and moves plain-text secrets out of .env. */
export function initVault(): void {
  readSecretFiles();
  if (process.platform !== 'win32' || process.env.VITEST || process.env.NETRUNNER_VAULT === 'off') return;
  active = { file: path.resolve(process.env.DATA_DIR || './data', 'secrets.enc'), protector: windowsProtector };
  // This runs while the app is still loading, before any error message box exists: it must never throw.
  try { load(); }
  catch (e) { problem(`Your API keys couldn't be loaded: ${firstLine(e)}`); }
}

/** Tests: switch the vault on with a scratch file and a fake protector (null switches it off). */
export function useVaultForTests(opts: { file: string; protector: KeyProtector } | null): void {
  active = opts;
  dataKey = null;
  current = {};
  problems = [];
  if (opts) load();
}

export const vaultActive = () => active !== null;
/** How secrets are stored: 'env' (plain .env), or encrypted and locked by the TPM / DPAPI. */
export const vaultStorage = (): Protection | 'encrypted' | 'env' => (active ? dataKey?.protection ?? 'encrypted' : 'env');

/** Opens the vault file into `current` / `dataKey`. Throws if it can't be unlocked. */
function unlock(): void {
  const { file, protector } = active!;
  const f = JSON.parse(fs.readFileSync(file, 'utf8')) as VaultFile;
  const wrapped = Buffer.from(f.key, 'base64');
  const key = protector.unwrap(f.protection, wrapped);
  current = openSecrets(f, key);
  dataKey = { key, protection: f.protection, wrapped };
}

function load(): void {
  const { file } = active!;
  if (fs.existsSync(file)) {
    try { unlock(); }
    catch (e) {
      // e.g. the TPM was cleared, or the file came from another PC or account. It might also be a passing
      // failure, so the file is kept and nothing is moved into a new vault on this start (.env values keep
      // working). Saving a key in the app tries once more before setting the old vault aside.
      problem(`Your saved API keys couldn't be unlocked (${firstLine(e)}). This happens if the PC's TPM was reset, or the data folder came from another PC or Windows account. Enter your keys again under AI Writer → API keys and Delivery.`);
      return;
    }
  }
  try { migrateFromEnvFile(); }
  catch (e) { problem(`Your keys in .env couldn't be moved into encrypted storage (${firstLine(e)}). They still work from .env; NetRunner tries again next time it starts.`); }
  // A real environment variable (or a value still in .env) wins over the vault.
  for (const k of VAULT_KEYS) if (current[k] && !process.env[k]?.trim()) process.env[k] = current[k];
}

function migrateFromEnvFile(): void {
  const file = envFile();
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const parsed = dotenv.parse(text);
  const found: Secrets = {};
  for (const k of VAULT_KEYS) if (parsed[k]?.trim()) found[k] = parsed[k].trim();
  const names = Object.keys(found);
  if (!names.length) return;
  writeVault(found);
  let next = applyEnvUpdates(text, Object.fromEntries(names.map(k => [k, ''])));
  if (!next.includes(ENV_NOTE.split('\n')[0])) next = `${ENV_NOTE}\n${next}`;
  writeFileAtomic(file, next);
  note('info', `moved ${names.join(', ')} from .env into ${active!.file} (encrypted, locked by ${dataKey!.protection.toUpperCase()})`);
}

/** Merges the updates ('' removes a key) into the saved secrets and re-encrypts. */
function writeVault(updates: Secrets): void {
  const { file, protector } = active!;
  if (!dataKey && fs.existsSync(file)) {
    // It couldn't be unlocked at start. Try again first (the failure may have passed) so no saved key is
    // lost; if it still fails, keep the old file aside rather than destroy it.
    try { unlock(); }
    catch { fs.renameSync(file, `${file}.unreadable-${Date.now()}`); current = {}; }
  }
  if (!dataKey) {
    const key = crypto.randomBytes(32);
    dataKey = { key, ...protector.wrap(key) };
  }
  const clean = Object.fromEntries(Object.entries({ ...current, ...updates }).filter(([, v]) => v)) as Secrets;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, JSON.stringify(sealSecrets(clean, dataKey), null, 2));
  current = clean;
}

/** Saves secrets from the app ('' removes one). Only call while vaultActive(). */
export function setVaultSecrets(updates: Secrets): void {
  try { writeVault(updates); }
  catch (e) { throw Object.assign(new Error(`The key couldn't be saved in encrypted storage: ${firstLine(e)}`), { statusCode: 500 }); }
}
