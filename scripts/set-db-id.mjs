#!/usr/bin/env node
/**
 * Writes a D1 database id into wrangler.jsonc, in place.
 *
 *   node scripts/set-db-id.mjs <database-id> [path-to-wrangler.jsonc]
 *
 * Kept separate from setup.sh so the edit is testable on its own, and so a
 * re-run is harmless: an id that is already correct is left alone.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const id = process.argv[2];
const file = process.argv[3] || 'wrangler.jsonc';

if (!id || !/^[0-9a-f-]{32,40}$/i.test(id)) {
  console.error(`Not a database id: ${JSON.stringify(id)}`);
  process.exit(1);
}

const before = readFileSync(file, 'utf8');

// Match the database_id line specifically, so nothing else in the file moves.
const line = /("database_id"\s*:\s*")([^"]*)(")/;
const found = before.match(line);

if (!found) {
  console.error(`No "database_id" field found in ${file}.`);
  process.exit(1);
}

if (found[2] === id) {
  console.log(`${file} already points at ${id}`);
  process.exit(0);
}

const after = before.replace(line, `$1${id}$3`);
writeFileSync(file, after);
console.log(`${file}: database_id ${found[2] || '(empty)'} -> ${id}`);
