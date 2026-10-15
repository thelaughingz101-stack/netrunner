import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isNativeBuildError } from '../src/db/db.js';

// npm 12 skips dependency install scripts unless package.json's allowScripts lists the package, and it
// only warns. better-sqlite3 then has no native build, and NetRunner can't open its database.
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));

describe('install scripts', () => {
  it('every dependency with an install script is allowed to run it (npm 12)', () => {
    const allowed = read('package.json').allowScripts ?? {};
    const needScripts = Object.entries<{ hasInstallScript?: boolean; optional?: boolean }>(read('package-lock.json').packages)
      // fsevents is macOS-only and optional: never installed on Windows, so its script never runs.
      .filter(([dir, p]) => dir && p.hasInstallScript && !p.optional)
      .map(([dir]) => dir.replace(/^.*node_modules\//, ''));
    expect(needScripts).toContain('better-sqlite3');
    for (const name of needScripts) expect(allowed[name], `${name} missing from allowScripts`).toBe(true);
  });

  it('recognises a missing or mismatched database engine build, so the desktop app says how to repair it', () => {
    expect(isNativeBuildError(new Error('Could not locate the bindings file. Tried:\n → C:\\NetRunner\\node_modules\\better-sqlite3\\build\\…'))).toBe(true);
    expect(isNativeBuildError(Object.assign(new Error('was compiled against a different Node.js version using NODE_MODULE_VERSION 137'), { code: 'ERR_DLOPEN_FAILED' }))).toBe(true);
    expect(isNativeBuildError(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }))).toBe(false);
  });
});
