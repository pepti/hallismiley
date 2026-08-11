#!/usr/bin/env node
'use strict';

// Validates a release manifest before it is published.
//
// The validator is not a second implementation of the schema — it is THE one,
// imported from server/services/updateChecker.js, the same code every deployed
// instance runs when it reads the manifest. That is deliberate: a publisher
// with its own idea of the schema is how you ship a manifest the whole fleet
// silently ignores.
//
// Usage:
//   node scripts/check-manifest.js path/to/stable.json [more.json …]
//   cat manifest.json | node scripts/check-manifest.js -
//
// Exit code 0 = every manifest is publishable. 1 = at least one is not.

const fs = require('fs');
const { validateManifest } = require('../server/services/updateChecker');

function readInput(file) {
  if (file === '-') return fs.readFileSync(0, 'utf8');
  return fs.readFileSync(file, 'utf8');
}

function checkOne(file) {
  let raw;
  try {
    raw = JSON.parse(readInput(file));
  } catch (err) {
    return { file, ok: false, errors: [`could not read as JSON: ${err.message}`] };
  }
  const result = validateManifest(raw);
  return result.ok
    ? { file, ok: true, manifest: result.manifest }
    : { file, ok: false, errors: result.errors };
}

function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: check-manifest.js <manifest.json> [...]  (use - for stdin)');
    process.exit(2);
  }

  let failed = 0;
  for (const file of files) {
    const result = checkOne(file);
    if (result.ok) {
      const m = result.manifest;
      console.log(`✓ ${file} — ${m.version} @ ${m.imageDigest.slice(0, 19)}…${m.critical ? ' (critical)' : ''}`);
    } else {
      failed++;
      console.error(`✗ ${file}`);
      for (const err of result.errors) console.error(`    ${err}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { checkOne };
