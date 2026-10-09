// Editing .env from the Config UI. Secret values go in and never come back out: the UI only gets
// "set / not set" plus the last 4 characters. Non-secret settings (SMTP host, port, user…) are returned
// as-is so the form can show them.
//
// Only the keys below can be written. Comments and every other line in .env are preserved.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { reloadEnv, validateEnvUpdate } from './env.js';

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

/** The .env dotenv loaded (cwd). NETRUNNER_ENV_FILE points tests at a scratch file. */
export const envFile = () => process.env.NETRUNNER_ENV_FILE || path.resolve(process.cwd(), '.env');

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

// dotenv doesn't unescape \" inside quotes, so values with quotes or line breaks are refused instead.
const quote = (v: string) => (/[\s#=]/.test(v) ? `"${v}"` : v);

/** Pure: rewrite .env text with the given values ('' clears a key). Unknown lines are untouched. */
export function applyEnvUpdates(text: string, updates: Partial<Record<EditableKey, string>>): string {
  const lines = text.split(/\r?\n/);
  const pending = new Map(Object.entries(updates));
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/);
    if (m && pending.has(m[1])) {
      lines[i] = `${m[1]}=${quote(pending.get(m[1])!)}`;
      pending.delete(m[1]);
    }
  }
  if (pending.size) {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    for (const [k, v] of pending) lines.push(`${k}=${quote(v)}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Writes the values to .env and applies them to this process right away (no restart needed). */
export function updateEnvFile(updates: Partial<Record<EditableKey, string>>): void {
  for (const [k, v] of Object.entries(updates)) {
    if (!(k in EDITABLE)) throw Object.assign(new Error(`${k} can't be edited from the app`), { statusCode: 400 });
    if (/["'`\r\n]/.test(v ?? '')) throw Object.assign(new Error(`${k}: quotes and line breaks aren't allowed`), { statusCode: 400 });
  }
  // e.g. SMTP_PORT "smtp" would make every later env() call throw, and the app wouldn't start again.
  validateEnvUpdate(updates as Record<string, string>);
  const file = envFile();
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, applyEnvUpdates(before, updates), 'utf8');
  fs.renameSync(tmp, file);
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
