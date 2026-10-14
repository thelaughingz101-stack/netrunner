import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no type declarations
import { compareVersions, copyRelease, explain, findExistingInstall, isInstall } from '../scripts/setup-update.mjs';

const write = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const pkg = (version: string) => JSON.stringify({ name: 'netrunner', version });

describe('Setup: update an existing install instead of installing twice', () => {
  let root: string, install: string, release: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-setup-'));
    install = path.join(root, 'NetRunner');
    release = path.join(root, 'Downloads', 'NetRunner-v1.0.2');
    write(path.join(install, 'package.json'), pkg('1.0.1'));
    write(path.join(install, 'src', 'old-module.ts'), 'removed in 1.0.2');
    write(path.join(install, 'src', 'index.ts'), 'v1.0.1');
    write(path.join(install, '.env'), 'GEMINI_MODEL=mine\n');
    write(path.join(install, 'data', 'netrunner.db'), 'my digests');
    write(path.join(install, 'node_modules', 'x', 'index.js'), 'dep');
    write(path.join(install, 'my-notes.txt'), 'not part of a release');
    write(path.join(release, 'package.json'), pkg('1.0.2'));
    write(path.join(release, 'src', 'index.ts'), 'v1.0.2');
    write(path.join(release, 'src', 'desktop.ini'), '[.ShellClassInfo]');
    write(path.join(release, '.env.example'), 'GEMINI_MODEL=\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('compares versions numerically', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.1', '1.0.2')).toBeLessThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
  });

  it('finds the install from the first usable candidate, never the download itself', () => {
    expect(findExistingInstall([null, path.join(root, 'gone'), release, install], release)).toMatchObject({ dir: install, version: '1.0.1', git: false });
    expect(findExistingInstall([release.toUpperCase()], release)).toBeNull();
    write(path.join(root, 'other', 'package.json'), JSON.stringify({ name: 'something-else' }));
    expect(findExistingInstall([path.join(root, 'other')], release)).toBeNull();
  });

  it('a fresh download is not an install; a folder NetRunner ran from is (so Setup repairs it in place)', () => {
    expect(isInstall(release)).toBe(false);
    expect(isInstall(install)).toBe(true);
  });

  it('flags a git checkout so Setup leaves it alone', () => {
    fs.mkdirSync(path.join(install, '.git'));
    expect(findExistingInstall([install], release)?.git).toBe(true);
  });

  it('copies the new version over the old, keeping settings, data and anything else', () => {
    copyRelease(release, install);
    const read = (f: string) => fs.readFileSync(path.join(install, f), 'utf8');
    expect(JSON.parse(read('package.json')).version).toBe('1.0.2');
    expect(read('src/index.ts')).toBe('v1.0.2');
    expect(fs.existsSync(path.join(install, 'src', 'old-module.ts'))).toBe(false);
    expect(fs.existsSync(path.join(install, 'src', 'desktop.ini'))).toBe(false);
    expect(read('.env')).toBe('GEMINI_MODEL=mine\n');
    expect(read('data/netrunner.db')).toBe('my digests');
    expect(read('node_modules/x/index.js')).toBe('dep');
    expect(read('my-notes.txt')).toBe('not part of a release');
  });

  it('a release folder that was already set up never overwrites the install’s settings', () => {
    write(path.join(release, '.env'), 'GEMINI_MODEL=fresh-default\n');
    write(path.join(release, 'data', 'netrunner.db'), 'empty');
    copyRelease(release, install);
    expect(fs.readFileSync(path.join(install, '.env'), 'utf8')).toBe('GEMINI_MODEL=mine\n');
    expect(fs.readFileSync(path.join(install, 'data', 'netrunner.db'), 'utf8')).toBe('my digests');
  });

  it('explains failures in plain words', () => {
    expect(explain(Object.assign(new Error('x'), { code: 'EBUSY', path: 'C:\\NetRunner\\src' }))).toMatch(/open in another program \(C:\\NetRunner\\src\)/);
    expect(explain(Object.assign(new Error('x'), { code: 'EPERM', path: '\\\\?\\C:\\NetRunner\\src' }))).toContain('(C:\\NetRunner\\src)');
    expect(explain(Object.assign(new Error('x'), { code: 'ENOSPC' }))).toMatch(/disk is full/);
    expect(explain(new Error('something odd'))).toBe('something odd');
  });
});
