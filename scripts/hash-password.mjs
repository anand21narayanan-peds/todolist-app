#!/usr/bin/env node
/**
 * Turns a password into the verifier string the Worker checks against.
 *
 *   node scripts/hash-password.mjs
 *
 * Prints a line like:
 *   pbkdf2$210000$<salt>$<hash>
 *
 * Paste that into:
 *   npx wrangler secret put APP_PASSWORD_HASH
 *
 * The password itself is never written to disk, never committed, and never
 * sent to Cloudflare — only this verifier is, and it cannot be reversed.
 */

import { pbkdf2, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const derive = promisify(pbkdf2);
const ITERATIONS = 210000; // OWASP's PBKDF2-SHA256 floor
const KEY_LEN = 32;

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

const password = (await ask('Choose a password: ')).trim();

if (password.length < 10) {
  console.error('\nToo short — use at least 10 characters. This is the only thing standing between the internet and your board.');
  process.exit(1);
}

const again = (await ask('Type it again: ')).trim();
if (again !== password) {
  console.error('\nThose did not match. Nothing was written.');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = await derive(password, salt, ITERATIONS, KEY_LEN, 'sha256');

console.error('\nSet this as the APP_PASSWORD_HASH secret:\n');
console.log(`pbkdf2$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`);
console.error('\n  npx wrangler secret put APP_PASSWORD_HASH\n');
