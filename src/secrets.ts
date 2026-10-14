// Editing keys and settings from the Config UI. Secret values go in and never come back out: the UI only gets
// "set / not set" plus the last 4 characters. Non-secret settings (SMTP host, port, user…) are returned
// as-is so the form can show them.
//
// Secrets go to the encrypted vault on Windows (vault.ts), to .env elsewhere. Only the keys below can be
// written. Comments and every other line in .env are preserved.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { reloadEnv, validateEnvUpdate } from './env.js';
import { applyEnvUpdates, envFile, isVaultKey, setVaultSecrets, vaultActive, writeFileAtomic } from './vault.js';

export { applyEnvUpdates, envFile };

export const EDITABLE = {
  GEMINI_API_KEY: { secret: true },
  ANTHROPIC_API_KEY: { secret: true },
  OLLAMA_URL: { secret: false },
  DISCORD_WEBHOOK_URL: { secret: true },
  SMTP_HOST: { secret: false },
  SMTP_PORT: { secret: false },
  SMTP_SECURE: { secret: false },
  SMTP_USER: { secret: false },
  SMTP_PASS: { secret: true },
  EMAIL_FROM: { secret: false },
} as const;
export type EditableKey = keyof typeof EDITABLE;

export interface KeyStatus { set: boolean; hint?: string; value?: string }

/** What the UI may see: never a secret's value, only whether it's set and its last 4 characters. */
export function keyStatus(): Record<EditableKey, KeyStatus> {
  const out = {} as Record<EditableKey, KeyStatus>;
  for (const [k, { secret }] of Object.entries(EDITABLE) as [EditableKey, { secret: boolean }][]) {
    const raw = (process.env[k] ?? '').trim();
    out[k] = secret
      ? { set: !!raw, ...(raw.length >= 12 ? { hint: raw.slice(-4) } : {}) }
      : { set: !!raw, value: raw };
  }
  return out;
}

/** Saves the values (secrets to the vault when it's on, the rest to .env) and applies them right away. */
export function updateEnvFile(updates: Partial<Record<EditableKey, string>>): void {
  for (const [k, v] of Object.entries(updates)) {
    if (!(k in EDITABLE)) throw Object.assign(new Error(`${k} can't be edited from the app`), { statusCode: 400 });
    if (/["'`\r\n]/.test(v ?? '')) throw Object.assign(new Error(`${k}: quotes and line breaks aren't allowed`), { statusCode: 400 });
  }
  // e.g. SMTP_PORT "smtp" would make every later env() call throw, and the app wouldn't start again.
  validateEnvUpdate(updates as Record<string, string>);
  const toVault: Record<string, string> = {};
  const toEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(updates)) (vaultActive() && isVaultKey(k) ? toVault : toEnv)[k] = v ?? '';
  const file = envFile();
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (Object.keys(toVault).length) {
    setVaultSecrets(toVault);
    // A plain copy left in .env would win on the next start and undo this save: blank it.
    const plain = dotenv.parse(before);
    for (const k of Object.keys(toVault)) if (plain[k]?.trim()) toEnv[k] = '';
  }
  if (Object.keys(toEnv).length) writeFileAtomic(file, applyEnvUpdates(before, toEnv));
  for (const [k, v] of Object.entries(updates)) {
    if (v) process.env[k] = v; else delete process.env[k];
  }
  reloadEnv();
}

/** Opens .env in Notepad, or its folder in Explorer with the file selected (Windows only). */
export function openEnvFile(how: 'file' | 'folder'): void {
  if (process.platform !== 'win32') throw Object.assign(new Error('only available on Windows'), { statusCode: 400 });
  const file = envFile();
  if (!fs.existsSync(file)) fs.writeFileSync(file, '', 'utf8');
  if (how === 'file') execFile('notepad.exe', [file], { windowsHide: false }).unref();
  else execFile('explorer.exe', [`/select,${file}`]).unref();
}
