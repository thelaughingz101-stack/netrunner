// Copies the pinned UI runtime (React, ReactDOM, Babel standalone) from node_modules into
// public/vendor so the Config UI never loads unpinned code from a CDN. Runs on postinstall.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const dest = path.join(root, 'public', 'vendor');
fs.mkdirSync(dest, { recursive: true });

const ver = pkg => require(`${pkg}/package.json`).version;
// package "exports" hide the UMD builds from require.resolve, so join from the package dir
const inPkg = (pkg, file) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), file);
const files = [
  [inPkg('react', 'umd/react.production.min.js'), `react-${ver('react')}.production.min.js`],
  [inPkg('react-dom', 'umd/react-dom.production.min.js'), `react-dom-${ver('react-dom')}.production.min.js`],
  [inPkg('@babel/standalone', 'babel.min.js'), `babel-standalone-${ver('@babel/standalone')}.min.js`],
];
for (const [src, name] of files) fs.copyFileSync(src, path.join(dest, name));
console.log('vendored:', files.map(f => f[1]).join(', '));
