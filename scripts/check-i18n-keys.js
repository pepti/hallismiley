#!/usr/bin/env node
// Verifies that every locale JSON file has exactly the same key set.
// Run in CI to catch drift the moment someone adds a key in one language
// but forgets the other. Exits non-zero on mismatch with a readable diff.
//
//   node scripts/check-i18n-keys.js

'use strict';

const fs   = require('fs');
const path = require('path');

// Pairs of (baseline, other) JSON files that must stay in lockstep.
const PAIRS = [
  {
    label: 'public/js/i18n',
    en: 'public/js/i18n/en.json',
    is: 'public/js/i18n/is.json',
  },
  {
    label: 'server/i18n',
    en: 'server/i18n/en.json',
    is: 'server/i18n/is.json',
  },
];

function loadJson(rel) {
  const full = path.resolve(__dirname, '..', rel);
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    console.error(`✗ Failed to read/parse ${rel}: ${err.message}`);
    process.exit(1);
  }
}

function diff(enKeys, isKeys) {
  const onlyEn = enKeys.filter(k => !isKeys.includes(k));
  const onlyIs = isKeys.filter(k => !enKeys.includes(k));
  return { onlyEn, onlyIs };
}

function findEmptyValues(obj) {
  return Object.keys(obj).filter(k => {
    const v = obj[k];
    return typeof v === 'string' && v.trim().length === 0;
  });
}

let failed = false;

for (const pair of PAIRS) {
  const en = loadJson(pair.en);
  const is = loadJson(pair.is);
  const enKeys = Object.keys(en).sort();
  const isKeys = Object.keys(is).sort();

  const { onlyEn, onlyIs } = diff(enKeys, isKeys);
  const emptyEn = findEmptyValues(en);
  const emptyIs = findEmptyValues(is);

  const ok = !onlyEn.length && !onlyIs.length && !emptyEn.length && !emptyIs.length;

  console.log(`${ok ? '✓' : '✗'} ${pair.label} — en: ${enKeys.length} keys, is: ${isKeys.length} keys`);
  if (onlyEn.length) {
    console.log(`  ⚠ only in en:\n    - ${onlyEn.slice(0, 50).join('\n    - ')}${onlyEn.length > 50 ? `\n    - … (+${onlyEn.length - 50} more)` : ''}`);
    failed = true;
  }
  if (onlyIs.length) {
    console.log(`  ⚠ only in is:\n    - ${onlyIs.slice(0, 50).join('\n    - ')}${onlyIs.length > 50 ? `\n    - … (+${onlyIs.length - 50} more)` : ''}`);
    failed = true;
  }
  if (emptyEn.length) {
    console.log(`  ⚠ empty values in en:\n    - ${emptyEn.join('\n    - ')}`);
    failed = true;
  }
  if (emptyIs.length) {
    console.log(`  ⚠ empty values in is:\n    - ${emptyIs.join('\n    - ')}`);
    failed = true;
  }
}

if (failed) {
  console.error('\n✗ i18n key check failed — see messages above.');
  process.exit(1);
}
console.log('\n✓ All locale files are in sync.');
