// Run by "Setup NetRunner.cmd" after npm ci. npm can finish without an error and still leave out a native
// part: npm 12 skips install scripts that package.json's allowScripts doesn't list (only a warning), and
// `ignore-scripts` in an .npmrc skips them all. Without its build, better-sqlite3 can't open the database
// and NetRunner can't start, so check it actually loads.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
try {
  const Database = require('better-sqlite3');
  new Database(':memory:').close();
} catch (err) {
  console.log(`        The database engine (better-sqlite3) did not install: ${String(err?.message ?? err).split('\n')[0]}`);
  process.exit(1);
}
