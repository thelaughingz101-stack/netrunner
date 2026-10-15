import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script, no type declarations
import { chooseFolder, compareVersions, copyRelease, defaultInstallDir, explain, findExistingInstall, folderState, installDirFor, isInstall, syncedBy, updateRefusal } from '../scripts/setup-update.mjs';

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
    expect(updateRefusal(findExistingInstall([install], release), '1.0.2')?.join(' ')).toMatch(/developer \(git\) checkout/);
  });

  it('never replaces an install with an older version', () => {
    const found = findExistingInstall([install], release);
    expect(updateRefusal(found, '1.0.0')?.join(' ')).toMatch(/older version \(1\.0\.0\)/);
    expect(updateRefusal(found, '1.0.2')).toBeNull();
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

describe('Setup: choosing where a new install goes', () => {
  let root: string, release: string, said: string[];
  const say = (s: string) => said.push(s);
  /** Answers the prompts in order; a browse answer comes from `picks`. */
  const run = (answers: string[], { suggested = path.join(root, 'Users', 'me', 'NetRunner'), picks = [] as (string | null)[], env = {} } = {}) =>
    chooseFolder({
      releaseDir: release, releaseVersion: '1.0.2', suggested, say, env,
      ask: async () => answers.shift() ?? (() => { throw new Error(`no answer left; said:\n${said.join('\n')}`); })(),
      browse: () => picks.shift() ?? null,
    });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-choose-'));
    release = path.join(root, 'Downloads', 'NetRunner-v1.0.2', 'NetRunner');
    said = [];
    write(path.join(release, 'package.json'), pkg('1.0.2'));
    write(path.join(release, 'src', 'index.ts'), 'v1.0.2');
    write(path.join(release, 'Setup NetRunner.cmd'), '@echo off');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('suggests a NetRunner folder in the user folder', () => {
    expect(defaultInstallDir('C:\\Users\\zionk')).toBe(path.join('C:\\Users\\zionk', 'NetRunner'));
  });

  it('puts NetRunner in its own folder inside the one picked', () => {
    expect(installDirFor('D:\\Apps')).toBe(path.join('D:\\Apps', 'NetRunner'));
    expect(installDirFor('D:\\Apps\\netrunner')).toBe(path.resolve('D:\\Apps\\netrunner'));
  });

  it('spots folders a cloud service syncs', () => {
    expect(syncedBy('C:\\Users\\me\\OneDrive\\Apps\\NetRunner', {})).toBe('OneDrive');
    expect(syncedBy('C:\\Users\\me\\OneDrive - Contoso\\NetRunner', {})).toBe('OneDrive');
    expect(syncedBy('D:\\Sync\\Work\\NetRunner', { OneDriveCommercial: 'D:\\Sync\\Work' })).toBe('OneDrive');
    expect(syncedBy('G:\\My Drive\\NetRunner', {})).toBe('Google Drive');
    expect(syncedBy('C:\\Users\\me\\Dropbox\\NetRunner', {})).toBe('Dropbox');
    expect(syncedBy('C:\\Users\\me\\NetRunner', { OneDrive: 'C:\\Users\\me\\OneDrive' })).toBeNull();
  });

  it('tells new, empty, NetRunner and occupied folders apart', () => {
    expect(folderState(path.join(root, 'nope'))).toBe('new');
    fs.mkdirSync(path.join(root, 'empty'));
    write(path.join(root, 'empty', 'desktop.ini'), '');
    expect(folderState(path.join(root, 'empty'))).toBe('empty');
    expect(folderState(release)).toBe('netrunner');
    write(path.join(root, 'stuff', 'photo.jpg'), 'x');
    expect(folderState(path.join(root, 'stuff'))).toBe('occupied');
  });

  it('Enter installs into the suggested folder: the release is copied there', async () => {
    const dir = await run(['']);
    expect(dir).toBe(path.join(root, 'Users', 'me', 'NetRunner'));
    expect(fs.readFileSync(path.join(dir, 'src', 'index.ts'), 'utf8')).toBe('v1.0.2');
    expect(fs.existsSync(path.join(dir, 'Setup NetRunner.cmd'))).toBe(true);
  });

  it('a typed path is shown back (with \\NetRunner added) before it is used', async () => {
    const apps = path.join(root, 'Apps');
    const dir = await run([`"${apps}"`, '']);
    expect(dir).toBe(path.join(apps, 'NetRunner'));
    expect(said).toContain(`    ${path.join(apps, 'NetRunner')}`);
  });

  it('a relative path is refused with an example of a whole one', async () => {
    const dir = await run(['Apps', '']);
    expect(said.join('\n')).toMatch(/whole path, starting with the drive/);
    expect(dir).toBe(path.join(root, 'Users', 'me', 'NetRunner'));
  });

  it('B opens the folder picker; cancelling keeps the suggestion', async () => {
    const picked = path.join(root, 'Picked');
    expect(await run(['b', 'B', ''], { picks: [null, picked] })).toBe(path.join(picked, 'NetRunner'));
  });

  it('refuses a folder that already holds other files', async () => {
    const busy = path.join(root, 'Busy', 'NetRunner');
    write(path.join(busy, 'thesis.docx'), 'x');
    const dir = await run(['', path.join(root, 'Elsewhere'), ''], { suggested: busy });
    expect(said.join('\n')).toMatch(/already has other files/);
    expect(dir).toBe(path.join(root, 'Elsewhere', 'NetRunner'));
    expect(fs.readFileSync(path.join(busy, 'thesis.docx'), 'utf8')).toBe('x');
  });

  it('a folder that already has NetRunner is updated, keeping its settings', async () => {
    const existing = path.join(root, 'Old', 'NetRunner');
    write(path.join(existing, 'package.json'), pkg('1.0.1'));
    write(path.join(existing, '.env'), 'GEMINI_MODEL=mine\n');
    expect(await run([''], { suggested: existing })).toBe(existing);
    expect(JSON.parse(fs.readFileSync(path.join(existing, 'package.json'), 'utf8')).version).toBe('1.0.2');
    expect(fs.readFileSync(path.join(existing, '.env'), 'utf8')).toBe('GEMINI_MODEL=mine\n');
  });

  it('never downgrades a folder that has a newer NetRunner', async () => {
    const newer = path.join(root, 'New', 'NetRunner');
    write(path.join(newer, 'package.json'), pkg('2.0.0'));
    const dir = await run(['', path.join(root, 'Other'), ''], { suggested: newer });
    expect(said.join('\n')).toMatch(/older version/);
    expect(dir).toBe(path.join(root, 'Other', 'NetRunner'));
    expect(JSON.parse(fs.readFileSync(path.join(newer, 'package.json'), 'utf8')).version).toBe('2.0.0');
  });

  it('warns about a synced folder and only uses it on Y', async () => {
    const synced = path.join(root, 'OneDrive', 'NetRunner');
    const elsewhere = path.join(root, 'Local');
    expect(await run(['', 'n', elsewhere, ''], { suggested: synced })).toBe(path.join(elsewhere, 'NetRunner'));
    expect(said.join('\n')).toMatch(/synced by OneDrive/);
    expect(fs.existsSync(synced)).toBe(false);
    said = [];
    expect(await run(['', 'y'], { suggested: synced })).toBe(synced);
  });

  it('choosing the extracted folder itself installs in place, copying nothing', async () => {
    expect(await run([''], { suggested: release })).toBe(release);
  });
});
